# Persona / Specialty System — Implementation Plan (Phase 1)

## Goal

Replace the current hardcoded "pediatric oncologist" persona — duplicated across
6+ files with no shared source of truth — with a single, backend-owned
`Specialty` config that each Cloud Function assembles its own prompt from,
pulling only the sections it needs. Ship pediatric oncology as the first
(default) specialty, preserving today's exact behavior, so this is a
refactor with zero behavior change until a second specialty is added.

**Explicitly out of scope for this phase:** category-weighted actionable-event
scoring (flat +15/match is preserved as-is). That requires new plumbing to
carry an event's category from extraction through to scoring, which doesn't
exist today in any form — tracked as a follow-up phase, not part of this work.

## Where assembly lives: backend (decided)

Frontend sends a `specialtyId` (defaulting to `"pediatric-oncology"` for
backwards compatibility) alongside its existing request fields. Each Cloud
Function fetches that specialty's config and assembles its own prompt
server-side. This matches how `extract-disease`, `final-analysis`, and `chat`
already hardcode prompts server-side today, and avoids shipping
prompt-engineering logic to the client.

## Storage

New Firestore collection: `specialties/{specialtyId}`, one document per
specialty, holding the full `Specialty` shape below. Read by every Cloud
Function that needs it (each already has a Firestore/GCP client
initialized, or can get one — `capricorn-chat` already uses Firestore).

Seed it with exactly one document on rollout: `pediatric-oncology`,
containing the current hardcoded text extracted verbatim into the new
shape (no rewording — this phase is structural, not a content rewrite).

## Schema

```ts
Specialty {
  id: string                 // "pediatric-oncology"
  label: string               // "Pediatric Oncology" (for UI display)

  // --- shared across all 5 consumers ---
  personaTitle: string         // "pediatric oncologist"
  boardName: string | null     // "International Leukemia Tumor Board (iLTB)" — null omits board framing

  // --- consumed ONLY by extract-disease ---
  diseaseExtraction: {
    guidance: string | null              // optional extra hint appended to generic task text
    fewShotExamples: { input: string, output: string }[]
  }

  // --- consumed ONLY by extract-events ---
  eventExtraction: {
    categories: {
      name: string                        // "Genetic alterations"
      instructions: string                // "ALWAYS include alteration type..."
      examples: string[]
    }[]
    fewShotExample: { caseNoteInput: string, expectedOutput: string }
  }

  // --- consumed ONLY by retrieve-full-articles (article scoring) ---
  articleScoring: {
    fields: {
      key: string          // "disease_match", "population_focus", "clinical_trial", ...
      label: string        // prose label shown to the model
      points: number        // single source of truth for BOTH prompt text and calculate_points()
      description: string
      optional: boolean     // e.g. population_focus is optional — some specialties may omit it
    }[]
  }

  // --- consumed ONLY by final-analysis ---
  finalAnalysis: {
    personaRole: string     // "pediatric hematologist" — can legitimately differ from personaTitle above
  }

  // --- consumed ONLY by chat ---
  chatContextLabel: string  // "pediatric oncology case"
}
```

Fixed, non-persona boilerplate (output-format rules, JSON schema skeleton,
markdown report skeleton, placeholder contract) stays in each function's
code, not in the Firestore doc — it's identical across all specialties and
shouldn't be duplicated per-document.

## Canonical placeholder contract (fixes an existing bug)

Today, the 3 sidebar templates use `{abstracts}`/`{question}` while the
actual backend substitution code only replaces `{article_text}`, `{disease}`,
`{events}`, `{journal_context}` — a real mismatch that silently breaks the
sidebar-template flow. This phase fixes it by making
`{article_text}` / `{disease}` / `{events}` / `{journal_context}` the one
and only placeholder vocabulary going forward; the sidebar `useTemplates`
system either gets retired or migrated onto the same `Specialty` schema
(recommend retiring it — its persistence gap and placeholder mismatch make
it not worth preserving as a separate mechanism).

## File-by-file changes

| File | Change |
|---|---|
| **New:** `backend/shared/specialty.py` (or per-function copy if a shared lib isn't set up yet) | Fetch-specialty-by-id helper + prompt-assembly functions for each of the 5 consumers |
| `backend/pubmed-search-tester-extract-disease/main.py` | Replace hardcoded `PROMPT` constant with: fetch specialty by `request_json.get('specialtyId', 'pediatric-oncology')`, assemble prompt from `personaTitle` + `boardName` + `diseaseExtraction.*` + fixed task boilerplate |
| `backend/pubmed-search-tester-extract-events/main.py` | Currently a pure pass-through (prompt built client-side). Change to: accept `specialtyId` instead of a raw prompt string from the frontend, assemble server-side from `eventExtraction.*` |
| `frontend/src/utils/api.js` (`extractEvents`) | Stop sending `promptContent` as a raw string; send `specialtyId` instead |
| `backend/capricorn-retrieve-full-articles/main.py` | `create_gemini_prompt()`: replace the hardcoded default `methodology_content` string with assembly from `articleScoring.fields`; `calculate_points()`: replace the hardcoded weight table (lines 111-181) with a loop over the same `articleScoring.fields` array — **single source of truth for prompt text and point math, closing the drift already found** (journal_impact/year-decay logic stays as fixed code, unrelated to the persona-driven fields) |
| `frontend/src/utils/api.js` (`retrieveAndAnalyzeArticles`) | Stop sending `methodology_content`; send `specialtyId` instead |
| `backend/capricorn-final-analysis/main.py` | `create_final_analysis_prompt()`: swap hardcoded `"pediatric hematologist"` for `specialty.finalAnalysis.personaRole`; report skeleton (tables, formatting rules) stays as fixed boilerplate, unchanged |
| `backend/capricorn-chat/main.py` | `create_gemini_prompt()`: swap hardcoded `"pediatric oncology case"` for `specialty.chatContextLabel`; rest of prompt stays fixed boilerplate |
| `frontend/src/hooks/useTemplates.js`, `frontend/src/templates/*.js`, `frontend/src/components/Sidebar.js` (template dropdown/editor) | Retire this system; replace the sidebar's template picker with a specialty picker that sets `specialtyId` in app state (read-only list from Firestore for this phase — custom user-authored specialties are a later phase, not part of this one) |
| `frontend/src/MedicalAssistantUI.js` | Thread `specialtyId` (from new specialty-picker state) into all 4 pipeline calls: `extractDisease`, `extractEvents`, `retrieveAndAnalyzeArticles`, `generateFinalAnalysis` |
| `frontend/src/utils/api.js` (`extractDisease`, `generateFinalAnalysis`, chat calls) | Add `specialtyId` to each request body |
| Firestore | New `specialties` collection; seed script or manual console entry for the `pediatric-oncology` doc |
| `README.md` | Update "pediatric oncology" scope language once a second specialty actually exists (not required for this phase alone, since default behavior is unchanged) |

## Migration sequencing (so nothing breaks mid-way)

1. Write the Firestore seed doc for `pediatric-oncology`, transcribing today's hardcoded strings into the new shape exactly (no wording changes) — do this first and diff it against the current hardcoded prompts to confirm nothing was lost in translation.
2. Update **one** backend function at a time (suggest starting with `extract-disease` — smallest, no JSON schema/scoring complexity), each time keeping a `specialtyId` default of `"pediatric-oncology"` so existing frontend calls (which won't send it yet) keep working unchanged.
3. Only after all 5 backend functions are converted and verified to produce identical output to before (same persona text in, same behavior out), update the frontend to actually send `specialtyId` and remove the old raw-prompt-string request fields (`promptContent`, `methodology_content`).
4. Retire the sidebar template system last, once the new specialty picker is in place and wired to the same `specialtyId` state.
5. Verification at each step: re-run the golden-path browser test (same one used for the deployment smoke test) and confirm the extracted disease, extracted events, article scores, and final analysis for the standard example case are unchanged before/after.

## Deferred (do not build now)

- **Category-weighted event scoring.** Requires: (a) `eventExtraction` output to carry a category tag per event instead of a flat string list, (b) that tag threaded through the BQ query/article-eval request instead of being discarded, (c) `articleScoring` extended so `matches_query` events carry category-specific point values instead of the flat +15. This is a second, separable project — the `Specialty` schema above is designed so it *can* be extended this way later (e.g. `eventExtraction.categories[].scoringWeight`) without another full migration, but none of the plumbing is being built in Phase 1.
- **Custom user-authored specialties** (the sidebar "add new template" equivalent) — Phase 1 ships a fixed, backend-curated specialty list. Read/write from the UI is later work.
- **Content authoring for new specialties** (writing real event taxonomies, few-shot examples, and scoring fields for e.g. cardiology or general oncology) — separate from this structural work, and should involve a domain expert the same way the current pediatric-oncology prompts clearly did.
