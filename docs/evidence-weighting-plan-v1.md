# Evidence Weighting v1 — Sliders for All 5 Current Scoring Factors

> Scope: adjust the factors that already influence `overall_points` today.
> No new factors (citation count, etc. — later), no retrieval changes (a
> paper vector search would retrieve today is retrieved regardless of
> slider settings — see [evidence-weighting-plan.md](evidence-weighting-plan.md)
> for that upgrade), no event-category splitting (genomics vs immunology
> sub-weights — also later).

## The 5 factors, and what each needs before it can be a slider

Traced exactly in `calculate_points()`
([specialty.py:141-185](../backend/capricorn-retrieve-full-articles/specialty.py#L141-L185)):

| # | Factor | Currently stored | What's needed |
|---|---|---|---|
| 1 | Journal impact (SJR-based) | Hardcoded formula constants (`× 5` multiplier, cap `25`) | Move multiplier + cap into the specialty schema as named fields |
| 2 | Recency / year decay | Hardcoded constant (`-5`/year) | Move decay rate into the specialty schema |
| 3 | Named boolean fields (Disease Match, Novelty, etc.) | Already in Firestore (`articleScoring.fields[].points`) | Nothing — already has an identity, just needs override plumbing |
| 4 | Paper type bonus (clinical trial / review) | Hardcoded constants (`+40` / `-5`) | Move both into the specialty schema |
| 5 | Matched actionable events | Already in Firestore (`articleScoring.perMatchedEventPoints`) | Nothing — already has an identity, just needs override plumbing |

**Step 1 is a schema addition**, not just a slider UI: factors #1, #2, #4
don't have a config identity today — they're bare numbers typed directly
into the Python formula. Before a doctor can see a slider defaulting to
"the current journal-impact multiplier," that multiplier has to actually
be *a named, stored value* somewhere. This plan lifts all three into
Firestore alongside the fields that are already there.

## Schema addition: extend `articleScoring`

Add three new named fields to `articleScoring` in every specialty doc
(seed default = today's hardcoded values, so nothing changes until a
doctor touches a slider):

```ts
articleScoring: {
  ...                          // fields[], domainFilterField, perMatchedEventPoints -- unchanged
  journalImpactMultiplier: 5,    // NEW -- today's hardcoded "× 5"
  journalImpactCap: 25,          // NEW -- today's hardcoded cap
  yearDecayRate: 5,              // NEW -- today's hardcoded "-5/year" (stored positive, applied as negative)
  clinicalTrialBonus: 40,        // NEW -- today's hardcoded "+40"
  reviewPenalty: 5,              // NEW -- today's hardcoded "-5" (stored positive, applied as negative)
}
```

This alone — before any slider UI exists — makes `calculate_points()` read
these from config instead of literals, so the *first* real step is a pure
refactor with zero behavior change (same verification approach used
throughout this project: diff the computed score for a known test article
before/after, confirm identical).

## Schema: `WeightOverrides` — one flat map, no tiers

```ts
WeightOverrides {
  [factorKey: string]: number
}
```

Keys are just the field names directly: `disease_match`, `novelty`,
`journalImpactMultiplier`, `yearDecayRate`, `clinicalTrialBonus`,
`reviewPenalty`, `perMatchedEventPoints`, etc. — one flat dictionary, no
nested tiers. Sent per-request alongside `specialtyId`, never persisted
back to the specialty's Firestore doc (same as everywhere else in this
system — doctor's emphasis for this case, not a permanent persona change).

## Backend changes

### 1. Add the 3 new fields to all 6 specialty JSON files

`backend/specialties/*.json` — add `journalImpactMultiplier: 5,
journalImpactCap: 25, yearDecayRate: 5, clinicalTrialBonus: 40,
reviewPenalty: 5` to every `articleScoring` block, re-seed Firestore.

### 2. `calculate_points()` — read from config + apply overrides

```python
def calculate_points(specialty, metadata, query_disease=None, weight_overrides=None):
    overrides = weight_overrides or {}
    scoring = specialty['articleScoring']

    def w(key, default):
        return overrides.get(key, default)

    points = 0
    breakdown = {}

    if metadata.get('journal_title') and metadata.get('journal_sjr'):
        sjr = float(metadata['journal_sjr'])
        if sjr > 0:
            multiplier = w('journalImpactMultiplier', scoring.get('journalImpactMultiplier', 5))
            cap = w('journalImpactCap', scoring.get('journalImpactCap', 25))
            impact_points = min(math.log(sjr + 1) * multiplier, cap)
            points += impact_points
            breakdown['journal_impact'] = impact_points

    if metadata.get('year'):
        try:
            decay_rate = w('yearDecayRate', scoring.get('yearDecayRate', 5))
            year_points = -decay_rate * (datetime.now().year - int(metadata['year']))
            points += year_points
            breakdown['year'] = year_points
        except (ValueError, TypeError):
            pass

    for field in scoring['fields']:
        if metadata.get(field['key']):
            field_points = w(field['key'], field['points'])
            points += field_points
            breakdown[field['key']] = field_points

    paper_type = (metadata.get('paper_type') or '').lower()
    if 'clinical trial' in paper_type:
        bonus = w('clinicalTrialBonus', scoring.get('clinicalTrialBonus', 40))
        points += bonus
        breakdown['paper_type'] = bonus
    elif 'review' in paper_type:
        penalty = w('reviewPenalty', scoring.get('reviewPenalty', 5))
        points -= penalty
        breakdown['paper_type'] = -penalty

    matched_events = sum(1 for e in metadata.get('actionable_events', []) if e.get('matches_query'))
    if matched_events > 0:
        per_event = w('perMatchedEventPoints', scoring['perMatchedEventPoints'])
        event_points = matched_events * per_event
        points += event_points
        breakdown['actionable_events'] = event_points

    return points, breakdown
```

Every single term now has a three-level fallback: doctor's override →
specialty's configured default → (only during the transition) the old
hardcoded literal. Once step 1 ships, that third level is never actually
reached, since every specialty doc will have all 5 values explicitly set.

### 3. `main.py` — thread `weightOverrides` through

- Request handler: `weight_overrides = request_json.get('weightOverrides')`.
- Pass through `stream_response()` → `analyze_with_gemini()` →
  `calculate_points(specialty, metadata, disease, weight_overrides)`.
- **No changes to `create_bq_query()` or the streaming/yield logic** —
  this is the whole point of keeping this v1-scoped.

## Frontend changes

### New component: `EvidenceWeightsReview`

Inserted after the "Specialty" box + disease/events extraction resolve,
before the auto-triggering retrieval `useEffect` fires (requires gating
that effect on explicit confirmation instead of firing immediately — the
one structural frontend change).

One slider per factor, **flat list, no grouping needed**:
- Disease Match, Drugs Tested, Treatment Results, Cell Studies, Animal
  Model Studies, Case Report, Series of Case Reports, Clinical Study,
  Novelty (+ any specialty-specific optional field) — default = each
  field's `points`
- Matched Actionable Events (per match) — default = `perMatchedEventPoints`
- Journal Impact Multiplier — default = `journalImpactMultiplier`
- Recency Decay Rate — default = `yearDecayRate`
- Clinical Trial Bonus — default = `clinicalTrialBonus`
- Review Penalty — default = `reviewPenalty`

"Use defaults" reset, "Continue to fetch papers" button → assembles the
flat `WeightOverrides` map → `retrieveAndAnalyzeArticles(..., weightOverrides)`.

### Files touched

| File | Change |
|---|---|
| `backend/specialties/*.json` (all 6) | Add `journalImpactMultiplier`, `journalImpactCap`, `yearDecayRate`, `clinicalTrialBonus`, `reviewPenalty` to `articleScoring` |
| `backend/capricorn-retrieve-full-articles/specialty.py` | `calculate_points()`: read all 5 factor groups from config + overrides, per the code above |
| `backend/capricorn-retrieve-full-articles/main.py` | Accept and thread `weightOverrides` through the call chain |
| New: `frontend/src/components/EvidenceWeightsReview.js` | Flat slider list |
| `frontend/src/MedicalAssistantUI.js` | Gate auto-retrieve effect on weight-panel confirmation; add `weightOverrides` state |
| `frontend/src/utils/api.js` | `retrieveAndAnalyzeArticles`: send `weightOverrides` |

## Sequencing

1. **Schema + refactor first, zero behavior change**: add the 3 new fields
   to all 6 specialty JSONs, refactor `calculate_points()` to read from
   config instead of literals, re-seed, redeploy. Verify via the same
   diff-against-known-output approach used for the persona migration —
   score a test article before/after, confirm identical `overall_points`.
2. **Add override plumbing**: thread `weightOverrides` through the request
   chain, verify via a curl test that overriding e.g. `novelty` actually
   changes the computed score for a known article.
3. **Build the `EvidenceWeightsReview` UI** and the gated-effect flow last.
   Full golden-path test: crank one slider to an extreme, confirm the
   resulting `overall_points`/ranking shifts accordingly while the *set*
   of retrieved papers stays identical to an unmodified run.

## Explicitly deferred (per your note — later, not now)

- Event-category-level sub-weights (genomics vs immunology) — requires
  tagging extracted events with category, which doesn't exist today.
- Making sliders affect *retrieval* (which papers get fetched at all), not
  just scoring — see the v2 plan.
- New factors not currently part of scoring at all (citation count, etc.)
  — see the v3 discussion.
