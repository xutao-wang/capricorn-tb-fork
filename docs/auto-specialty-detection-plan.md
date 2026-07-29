# Automatic Specialty Detection — Implementation Plan

## Goal

Remove manual specialty selection. Instead: the doctor inputs case notes as
today, the backend automatically classifies which specialty/persona should
analyze the case, and the detected persona is displayed as a **third box**
alongside "Extracted disease" and "Extracted events" in the extraction
section of the UI.

## Why this can't just be "add a classifier call" — the sequencing problem

`extract-disease` and `extract-events` are themselves specialty-driven:
their prompts (persona, event-category taxonomy, few-shot examples) come
from whichever specialty's Firestore doc is fetched. That means **the
specialty must be known before those two calls run**, not decided in
parallel with them. Today's flow:

```
handleExtract()
  → Promise.all([extractDisease(text, specialtyId), extractEvents(text, specialtyId)])
```

becomes:

```
handleExtract()
  → detectSpecialty(text)                      // NEW, sequential, first
  → Promise.all([extractDisease(text, detected.id), extractEvents(text, detected.id)])
```

This adds one sequential round-trip of latency before extraction can even
start. Mitigation: use a fast/cheap model for detection (`gemini-3.1-flash-lite`,
same tier as extract-disease/extract-events) and a short, single-purpose
prompt — this should be one of the fastest calls in the whole pipeline, not
a bottleneck.

## New backend function: `detect-specialty`

A new Cloud Function, structurally mirroring `extract-disease`
(`backend/pubmed-search-tester-extract-disease/`), but classifying instead
of extracting.

### What it needs that doesn't exist yet: specialty *descriptions*

Classification needs more signal than just a `label` string
("Cardiology") — it needs a short plain-language description of what each
specialty covers, so the model can match case content against it. This
requires a schema addition:

```ts
Specialty {
  ...
  description: string   // NEW — e.g. "Inherited and structural heart
                         // conditions: cardiomyopathies, arrhythmias,
                         // heart failure, congenital heart disease."
}
```

Action: add a `description` field to all 5 existing seed JSON files in
`backend/specialties/*.json`, and require it going forward for any new
specialty (including the "Add a new specialty" form — one more field to
collect there).

### Request/response contract

- **Request**: `{ text: <case notes + lab results> }` — no `specialtyId`,
  since the whole point is we don't know it yet.
- **Response**: structured JSON (not a raw string, unlike
  `extract-disease`) so the UI can show more than just an ID:
  ```json
  { "specialtyId": "cardiology", "rationale": "Case centers on an inherited arrhythmia syndrome with a pathogenic ion-channel variant." }
  ```
  The `rationale` is optional/nice-to-have for the third box's transparency,
  but genuinely useful for doctor trust in an auto-selected persona — cheap
  to ask the model for in the same call.

### Implementation

- `backend/capricorn-detect-specialty/main.py` (new directory, same
  structure as the other 8 functions): fetch **all** specialty docs (new
  Firestore access pattern — a collection-wide `list()`, not a single
  `get()` by ID like every other function does today), build a prompt
  listing each `{id, label, description}`, ask the model to choose one and
  justify briefly, parse the JSON response.
- `backend/capricorn-detect-specialty/specialty.py`: a `list_specialties()`
  helper (new — every other function's `specialty.py` only has
  `get_specialty(id)` for a single doc).
- Deploy like the others: `requirements.txt` (functions-framework, Flask,
  google-genai, vertexai, google-cloud-firestore), `.env.yaml`
  (`PROJECT_ID`, `LOCATION`, `DATABASE_ID`), `--allow-unauthenticated`
  Gen2 deploy.

### Fallback for ambiguous/poorly-matched cases

Forced-choice classification among 5 specialties will always return
*something*, even for a case that doesn't fit well (e.g. a general
internal-medicine case with no oncology/cardiology/neuro/GI focus).
Recommend adding a **`general-medicine` catch-all specialty** (broad
persona: "general internist", generic event categories: symptoms, lab
abnormalities, comorbidities, medication history) as a safety net so the
classifier has a reasonable default rather than being forced into an
ill-fitting specialist persona.

## Frontend changes

### New state: `detectedSpecialty`

Replaces the manual-selection `selectedSpecialtyId` from `useSpecialties`
as the thing that actually drives the pipeline. `useSpecialties` (already
built) is repurposed:
- Its specialty **list** is no longer needed client-side for a picker
  dropdown (detection happens server-side, fetching its own list from
  Firestore) — but keep `getSpecialties`/`createSpecialty` in `firebase.js`
  since the "Add a new specialty" capability likely still has value as an
  **override path** (see below), and an admin-facing specialty list view
  is plausible later.
- Remove the `SpecialtyPicker` dropdown from `CaseInputSection.js` (revert
  that wiring — no manual selection at case-entry time).

### Pipeline change in `MedicalAssistantUI.js`

In `handleExtract` (around where `extractDisease`/`extractEvents` are
currently called):

```js
const detected = await detectSpecialty(combinedNotes);   // new api.js call
setDetectedSpecialty(detected);                            // {id, label, personaTitle, rationale}

const [disease, events] = await Promise.all([
  extractDisease(combinedNotes, detected.id),
  extractEvents(combinedNotes, detected.id)
]);
```

`detected.id` then threads through exactly where `selectedSpecialtyId` was
already wired in the prior work — `retrieveAndAnalyzeArticles` and
`generateFinalAnalysis` calls need no further change beyond swapping the
source variable.

### New API call: `frontend/src/utils/api.js`

```js
export const detectSpecialty = async (text) => {
  const response = await fetch('https://detect-specialty-<hash>-uc.a.run.app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return response.json(); // { specialtyId, rationale }
};
```

### UI: third box in `ExtractionSection.js`

Current structure (`frontend/src/components/MainPanel/ExtractionSection.js:62-93`)
has two rows inside the expandable panel: "Extracted disease" and
"Extracted events". Add a third row above or below them:

```jsx
<div className="flex items-center gap-2">
  <label className="text-[10px] font-light text-gray-700 w-20">Specialty</label>
  <div className="relative flex-1">
    <div className="w-full p-1.5 border border-gray-300 rounded-lg text-xs bg-gray-50">
      {detectedSpecialty ? detectedSpecialty.label : ''}
    </div>
    {!detectedSpecialty && (
      <span className="absolute inset-0 flex items-center px-2 italic text-gray-400 text-[10px] font-light pointer-events-none">
        Specialty will appear here after detection...
      </span>
    )}
  </div>
</div>
```

- Since detection now runs *first*, this box's content resolves *before*
  the disease/events boxes fill in — good, matches the natural read order
  (specialty identified → then its persona extracts disease/events).
- `onExtractionComplete` trigger (`ExtractionSection.js:31-35`) should
  require `detectedSpecialty` in addition to `extractedDisease` and
  `events.length > 0`, so the section doesn't report "complete" before all
  three have resolved.
- Header text ("Disease and actionable events extracted",
  `ExtractionSection.js:44`) should update to reflect the added step, e.g.
  "Specialty identified, disease and actionable events extracted."
- Props: `ExtractionSection` needs `detectedSpecialty` passed down from
  `ChatContainer.js:161-168` → sourced from `MainPanel.js:209-210`'s
  sibling props → from `MedicalAssistantUI.js` state. Same prop-drilling
  pattern already used for `extractedDisease`/`extractedEvents`.

### Optional but recommended: override affordance

Auto-detection can be wrong, and this is a clinical tool — doctors need a
way to correct a misclassified persona rather than silently proceeding with
the wrong one. Recommend a small "not right? change" link/icon next to the
detected specialty in the third box, which reopens a lightweight version of
the picker already built (reusing `SpecialtyPicker`'s dropdown, minus the
case-entry-screen placement) to let the doctor manually override
`detectedSpecialty` before extraction proceeds. This preserves the value of
the picker/modal work already done rather than discarding it, and adds a
meaningful trust/safety mechanism for a feature that's now fully automatic
by default. **This is a recommendation, not a requirement — confirm whether
you want it in scope before I build it.**

## Files touched

| File | Change |
|---|---|
| `backend/specialties/*.json` (all 5) | Add `description` field |
| New: `backend/capricorn-detect-specialty/main.py`, `specialty.py`, `requirements.txt`, `.env.yaml` | New Cloud Function |
| `frontend/src/utils/api.js` | New `detectSpecialty()`; no change needed to `extractDisease`/`extractEvents`/`retrieveAndAnalyzeArticles`/`generateFinalAnalysis` signatures (already accept `specialtyId`) |
| `frontend/src/MedicalAssistantUI.js` | Add `detectedSpecialty` state; call `detectSpecialty` before the extraction `Promise.all`; remove `selectedSpecialtyId`/`setSelectedSpecialtyId` sourcing from `useSpecialties` picker flow; pass `detectedSpecialty` down to `MainPanel` → `ChatContainer` → `ExtractionSection` |
| `frontend/src/components/MainPanel/CaseInputSection.js` | **Revert** the `SpecialtyPicker` wiring added in the prior (now-superseded) manual-selection work |
| `frontend/src/components/MainPanel/ExtractionSection.js` | Add third "Specialty" row; update completion-trigger condition and header text |
| `frontend/src/components/MainPanel/MainPanel.js`, `frontend/src/components/Chat/ChatContainer.js` | Thread `detectedSpecialty` prop through (same pattern as `extractedDisease`) |
| (Optional) `frontend/src/components/SpecialtyPicker.js` | Repurpose as an override control rather than case-entry picker, if the override affordance is in scope |

## Sequencing

1. Add `description` to all 5 specialty JSON files, re-seed Firestore.
2. Build and deploy `detect-specialty` in isolation; verify via curl with a
   few test case notes across different specialties (lung cancer → adult
   oncology, arrhythmia case → cardiology, etc.) before touching the
   frontend.
3. Revert the manual `SpecialtyPicker` wiring in `CaseInputSection.js`.
4. Wire `detectSpecialty` into `handleExtract`'s sequencing in
   `MedicalAssistantUI.js`; confirm `extractDisease`/`extractEvents` still
   receive a valid `specialtyId` end-to-end via the existing
   Cloud-Logging `Using specialty: <id>` line added earlier.
5. Add the third box to `ExtractionSection.js` and thread the prop chain.
6. Full golden-path browser test with at least two different case types
   (one pediatric-oncology-shaped, one clearly non-oncology like a cardiac
   case) to confirm detection actually switches personas correctly, not
   just defaulting to pediatric-oncology every time.
7. (If in scope) build the override affordance last, once automatic
   detection is confirmed working end-to-end.

## Open questions before implementation

1. **Confirm the override affordance is in scope** (see above) — changes
   whether `SpecialtyPicker` gets repurposed or left unused.
2. **Should `rationale` be shown to the doctor** in the third box (small
   tooltip/subtext), or is just the specialty name sufficient? Showing it
   costs nothing extra (already in the response) and adds trust.
3. **Should detection re-run if the doctor edits the case notes after the
   fact** (e.g. via the editable disease/events text areas), or is
   detection a one-shot decision made at initial submission? Recommend
   one-shot for now — re-running on every edit would add latency/cost and
   risk the persona flip-flopping mid-case.
