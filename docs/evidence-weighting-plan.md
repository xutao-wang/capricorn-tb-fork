# Evidence Weighting — Implementation Plan (v2: affects retrieval, not just ranking)

> Supersedes the earlier version of this plan, which only made weights
> affect display ranking. This version makes weights determine which
> papers survive into the doctor's results at all — a materially bigger
> architectural change, detailed below.

## Goal

Let a doctor adjust, per-case, how much each scoring factor matters — e.g.
"weight genomic findings more than immunophenotype findings," or "I don't
care about cell-culture studies, only clinical trials" — via a slider panel
inserted after specialty detection and extraction, before retrieval runs.
These weights must influence **both** which papers get retrieved and how
they're ranked, not just the latter.

## Part 1: Confirmed current state (re-verified against the live code)

| Step | What decides it today | Weight-driven? |
|---|---|---|
| **Which papers get fetched** | `create_bq_query()` — BigQuery `VECTOR_SEARCH` on embedding distance between `disease + events_text` and the corpus; over-fetch/dedup/`ORDER BY distance LIMIT num_articles` ([main.py](../backend/capricorn-retrieve-full-articles/main.py)) | **No** — pure embedding distance |
| **Per-article score** | `calculate_points()` — `articleScoring.fields` (flat points from specialty config) + fixed journal-impact/year-decay/paper-type formulas + flat `perMatchedEventPoints` per matched event regardless of category | Partially — uses specialty defaults, not doctor-adjustable per case |
| **Display order** | Frontend sorts the *already-fixed* `num_articles` set by `overall_points` | Ranking only |
| **What reaches final-analysis** | All `num_articles` papers, unfiltered | Not filtered by score at all |

**The core problem**: today's pipeline picks exactly `num_articles` papers
by embedding distance, analyzes exactly those, and never reconsiders that
set. For weights to affect "getting the papers," the set of papers that
make it to the doctor's screen must be able to change based on weighted
score — which requires analyzing *more* candidates than end up being shown,
then keeping only the top-scoring ones.

## Part 2: Making weights affect retrieval — the actual mechanism

### The widen-then-select pattern

Change the pipeline from "fetch exactly N by distance, analyze all N, show
all N" to:

1. **Fetch a wider candidate pool** — `candidate_pool_size = num_articles × WIDENING_FACTOR` (e.g. 2×) papers, still selected by embedding distance (this part is unavoidable — embeddings are the only retrieval mechanism available, and they aren't decomposable into per-category sub-vectors you could reweight directly).
2. **Analyze all candidates in the pool** with Gemini + `calculate_points()`, using the doctor's weight overrides.
3. **Keep only the top `num_articles` by weighted score**; discard the rest.

This means a paper ranked #16 by embedding distance (and therefore excluded
today) can now displace a paper ranked #10 by distance, if the doctor's
weights favor whatever #16 has more. **That's the concrete, honest way
"weights affect getting the papers" — not literally reweighting the vector
search (not practically meaningful, since BigQuery's `VECTOR_SEARCH` has no
concept of weighted sub-dimensions), but widening the net and using
weighted score instead of raw distance to decide the final cut.**

### Cost/latency tradeoff — must be sized deliberately

Every additional analyzed candidate is a full Gemini call on complete
article text (the expensive step in this pipeline, per the existing
per-article rate-limit/retry logic in `analyze_with_gemini`). Widening
2× roughly doubles this step's cost and wall-clock time. Recommend:
- Default `WIDENING_FACTOR = 1.5–2×`, capped at a fixed maximum (e.g. never
  analyze more than 30 candidates regardless of `num_articles`), so a
  doctor requesting `num_articles=50` doesn't trigger 100 Gemini calls.
- Surface the widening factor as a setting the doctor could also adjust
  (more candidates = slower but more thorough), or keep it fixed for v1
  and revisit if cost becomes a concern.

### Open problem: this conflicts with today's progressive-streaming UX

Right now, articles stream to the frontend one at a time as each is
analyzed (`yield json.dumps(response_obj)` per article), so the doctor sees
results populate live during processing — good UX. Widen-then-select
breaks this: you can't know if candidate #3 belongs in the final top-N
until candidates #4 through #30 have also been analyzed and scored. Three
ways to resolve this, **need a decision before building**:

| Option | UX | Complexity |
|---|---|---|
| **A. No streaming for final results** — analyze the whole widened pool, then send the final top-N in one batch | Doctor waits the full widened-pool duration with no progressive feedback (worse than today) | Simplest |
| **B. Stream provisional results, then reconcile** — stream all candidates as analyzed (as today), then a final message says "re-ranked: these N made the cut" and the UI removes/reorders what's shown | Visually jarring — articles doctor was already reading might disappear | Medium |
| **C. Two-phase: show fast preliminary results, then upgrade** — stream the first `num_articles` (by distance, today's behavior) immediately as "preliminary," continue analyzing the remaining widened candidates in the background, then replace with the final weighted top-N when ready, clearly labeled as provisional → final | Best of both — immediate feedback + eventually-correct weighted result | Most complex |

**Recommend Option C** if the added complexity is acceptable, since it's
the only one that doesn't regress today's "see results as they come in"
experience. Otherwise Option A is the pragmatic fallback.

## Part 3: What gets a slider — full scope

"For each parameter" spans three tiers of very different implementation
cost:

### Tier 1 — already discrete, named, point-valued (cheap)
`articleScoring.fields` per specialty — Disease Match, Drugs Tested,
Treatment Results, Cell Studies, Animal Model Studies, Case Report, Series
of Case Reports, Clinical Study, Novelty, and any specialty-specific
optional fields (e.g. Pediatric Focus). Each already has a `points` value
in Firestore — a slider per field, defaulting to that value, is a direct
override with no new data flows.

### Tier 2 — event-category weights (new plumbing required)
Genomics vs immunology vs chromosome-level vs drug-sensitivity, etc.
Requires the same fix identified before: `extract-events` must tag each
event with its source category (`[{event, category}]` instead of a flat
string list), and `calculate_points()` must look up a per-category weight
instead of the flat `perMatchedEventPoints` for every match.

### Tier 3 — currently-hardcoded formulas (most invasive, recommend deferring)
Journal-impact scoring (`log(sjr+1) × 5`, capped 25), year-decay (-5/year),
and paper-type keyword bonus (+40 clinical trial / -5 review) are Python
formulas, not simple point lookups. Making these sliders means
parameterizing the formulas themselves (e.g. a "recency importance"
multiplier applied to the year-decay rate, a "journal prestige" multiplier
on the log-scaled score). **Recommend Tier 3 as a later phase** — it's the
least clear-cut in terms of what a doctor-facing slider should even mean
(what does "0.5× journal impact" communicate to a clinician?), versus
Tiers 1–2 which map directly onto named, self-explanatory criteria.

**Recommend building Tiers 1–2 now, deferring Tier 3.**

## Schema: `WeightOverrides`

```ts
WeightOverrides {
  scoringFieldWeights: { [fieldKey: string]: number }      // Tier 1, e.g. { disease_match: 50, novelty: 25 }
  eventCategoryWeights: { [categoryName: string]: number } // Tier 2, e.g. { "Genetic alterations": 30, "CD markers / Immunophenotype": 10 }
}
```

Sent per-request alongside `specialtyId` — **never persisted back to the
specialty's Firestore doc** (same design decision as before: this is the
doctor's emphasis for this case, not a permanent change to the shared
persona). Sliders default to the detected specialty's configured values.

## Backend changes

### 1. `extract-events` — tag each event with its category (Tier 2 prerequisite)

Same change as previously planned: output structured
`[{ event, category }]` JSON instead of a quoted string list. Ripple
effects to `retrieveAndAnalyzeArticles`'s query-anchor text and
`generateFinalAnalysis`'s events display need flattening back to plain
event strings where category isn't meaningful (see file list below).

### 2. `retrieve-full-articles` — the widen-then-select restructuring

This is the substantial part:
- Accept `weightOverrides` and (if exposed) a widening factor in the
  request.
- `create_bq_query()`: change `LIMIT num_articles` to
  `LIMIT candidate_pool_size` (the widened count).
- `stream_response()`: depending on the streaming-UX decision (Part 2
  above), either (A) accumulate all analyzed candidates before yielding
  final results, or (C) yield preliminary results immediately from the
  first `num_articles` by distance, then yield a final reconciliation
  message once the full widened pool is analyzed and top-N selected by
  weighted score.
- `calculate_points()`: apply `weightOverrides.scoringFieldWeights` as
  point-value overrides (Tier 1); apply `weightOverrides.eventCategoryWeights`
  with per-category lookup replacing the flat `perMatchedEventPoints`
  (Tier 2), using the patient's own tagged event list to determine which
  category a matched article-event inherits from (avoids relying on the
  model to re-derive category from scratch for the article's own mention).
- After scoring all widened candidates: sort by weighted `overall_points`,
  truncate to `num_articles`, and only stream/return that final set.

### 3. `final-analysis` — no changes required

Receives whatever final top-N set `retrieve-full-articles` already decided;
doesn't need its own weight-awareness.

## Frontend changes

### New component: `EvidenceWeightsReview`

Inserted after specialty detection + disease/event extraction complete
(i.e., after the third "Specialty" box and the disease/events boxes
resolve), before the auto-triggering retrieval `useEffect` fires — same
gating change as previously planned: convert the current auto-trigger into
one that waits for explicit confirmation.

Panel shows:
- One slider per **Tier 1** `articleScoring.fields` entry for the detected
  specialty, defaulting to that field's `points`.
- One slider per **Tier 2** event category actually present in this case's
  extracted events (grouped, not per individual event), defaulting to a
  flat baseline (today's 15) unless the specialty defines per-category
  defaults (none do yet — see open question below).
- "Use defaults" reset, "Continue to fetch papers" button.

On continue: assemble `WeightOverrides`, call
`retrieveAndAnalyzeArticles(..., weightOverrides)`.

### Files touched

| File | Change |
|---|---|
| New: `frontend/src/components/EvidenceWeightsReview.js` | Slider panel |
| `frontend/src/MedicalAssistantUI.js` | Gate the auto-retrieve effect on weight-panel confirmation; add `weightOverrides` state; thread into `retrieveAndAnalyzeArticles` |
| `frontend/src/utils/api.js` | `extractEvents`: parse structured `{event, category}` JSON; `retrieveAndAnalyzeArticles`: send `weightOverrides` |
| `backend/pubmed-search-tester-extract-events/{main,specialty}.py` | Structured category-tagged output |
| `backend/capricorn-retrieve-full-articles/main.py` | Widen candidate pool; accept `weightOverrides`; restructure streaming per the chosen UX option |
| `backend/capricorn-retrieve-full-articles/specialty.py` | `calculate_points()`: Tier 1 + Tier 2 override support |

## Sequencing

1. **Ship Tier 1 (scoring-field overrides) with no retrieval change first** — sliders affect ranking/display only, exactly like the v1 plan. Zero risk to the streaming UX, independently useful, verifiable via the existing Cloud Logging technique.
2. **Decide the streaming-UX option (A/B/C above)** — this is a product decision, not just an engineering one, and blocks step 3.
3. **Build the widen-then-select restructuring** for Tier 1 weights only (no category tagging yet) — verify that widening actually changes which papers appear when weights are skewed hard toward one field (e.g. crank Novelty to max, confirm a previously-excluded-by-distance-but-novel paper now appears).
4. **Convert `extract-events` to structured category output**, verify against golden-path fidelity testing (same approach used for the persona migration).
5. **Add Tier 2 category-weight lookup**, defaulting to flat behavior when untouched — confirm scores are unchanged from before when no weights are adjusted.
6. **Build the `EvidenceWeightsReview` UI** last, once the full data layer (Tiers 1+2, widen-then-select) is solid.
7. (Optional, later) Tier 3 formula parametrization.

## Open questions — need decisions before implementation

1. **Streaming UX (Part 2)** — A, B, or C? This is the single biggest product decision in this plan.
2. **Widening factor** — fixed at 2×, doctor-adjustable, or capped at some absolute max regardless of `num_articles`?
3. **Tier 2 defaults per category** — should each specialty's `eventExtraction.categories` gain a default weight (requiring a schema addition and updating all 6 seed files), or should every category just start at a flat baseline until a doctor adjusts it?
4. **Persistence** — do weight overrides persist in `localStorage` across cases for the same specialty (so a doctor who prefers genomics-heavy scoring doesn't re-adjust every time), or reset to specialty defaults each time?
5. **Cost guardrail** — should there be a hard ceiling on total Gemini calls per retrieval request (e.g. never analyze more than 30 candidates) independent of `num_articles` × widening factor, to bound worst-case cost?
