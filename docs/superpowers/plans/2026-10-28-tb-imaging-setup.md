# TB Imaging Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Independent read-only review and one bounded implementation agent may run alongside root-owned work. Do not run multiple implementation subagents concurrently or share Git staging ownership.

**Goal:** A locally tested, reviewable TB fork upgrade with single-image CXR/CT perception, explicit finding review and safe literature search, ready for separately approved cloud deployment.

**Architecture:** Work on the requested fork's `codex/tb-imaging-setup` branch. Preserve its image UI and deterministic SJR scoring while porting the existing Firebase/SQL/config protection. A separate image endpoint returns validated draft findings; only reviewed phenotypes enter case extraction and search.

**Tech Stack:** React 18 / Firebase 11, Python 3.12 / Functions Framework, google-genai, Pydantic, pydicom 3, Pillow / NumPy, Firestore, BigQuery, Vertex AI.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-10-28-tb-imaging-design.md`.
- No cloud mutation, live inference or paid query until the final cloud/budget approval.
- Project `njms-tb-image-study`; database `capricorn-dev`; region `us-central1`; Gemini `global`; BigQuery `US`.
- Preserve original checkout `/Users/xutaowang/Documents/Rutgers_work/capricorn_v2`, especially `.deploy/` and environment files.
- Synthetic local test data only. Never print keys, tokens, raw images, case/model text or untrusted exception bodies. No remote source publication.
- Original nine source folders and entry points remain; add `capricorn-analyze-image:analyze_image`.
- Firebase verified Google allowlist and revocation checks on all ten endpoints; per-owner data; restricted CORS; zero minimum/one maximum instances/concurrency one.
- Image function 1 GiB; others 512 MiB; timeout 540 seconds. File 5 MiB / decoded pixels 16M / preview 2048px; single-frame only.
- Keep the fork's deterministic SJR lookup and `min(max(n, int(n * 1.4)), 25)` pool formula; default/max displayed articles one. No original full-journal prompt restoration.
- Model proposals: image/article/chat/lab `gemini-3.8-flash`; extractor/trials `gemini-3.1-flash-lite`; final `gemini-3.1-pro-preview`; embeddings `text-embedding-005`.
- TDD for changed behavior. Keep a red/green evidence log. Root alone stages/commits shared-tree changes and performs any future cloud operations.

## Shared contracts

The image endpoint returns the existing outer envelope, with a stricter validated inner document:

```json
{
  "success": true,
  "data": {
    "parsedFindings": {
      "modality": "CXR",
      "technicalQuality": "adequate",
      "findings": [{"name":"cavitation","status":"indeterminate","location":null,"description":"Not established from this image"}],
      "summaryText": "Draft research observations"
    },
    "summaryText": "Draft research observations",
    "actionableEvents": [],
    "metadata": {"Format":"DICOM","OriginalDimensions":"256x256","PreviewDimensions":"256x256"},
    "previewImage": "data:image/jpeg;base64,...",
    "reviewRequired": true,
    "model": "gemini-3.8-flash"
  }
}
```

`modality`: `CXR`, `CT_SLICE` or `UNKNOWN`; quality: `adequate`, `limited` or `uninterpretable`; finding status: `present`, `absent`, `indeterminate` or `not_assessable`. All four core named findings are represented: `cavitation`, `consolidation`, `bilateral_extent`, `miliary_pattern`. `actionableEvents` contains candidate positive phenotype descriptions only; no diagnosis, resistance or treatment claim. A result is a draft even when model JSON is well formed.

Existing disease/event endpoints may keep their successful text response format. Backend and frontend adapters reject no-disease/no-event prose rather than treating it as valid content. Specialty classification adds `isClinicalCase`; false/missing/failed classification cannot invoke new-persona generation. Client adapters must handle a typed future response without accepting arbitrary text as an event.

## Task 1: Preserve fork behavior while securing core backend (root)

**Files:** `backend/capricorn_runtime/{__init__,config,security,clinical}.py`; original nine `main.py`, `specialty.py`, `clinical_trials.py`, two BQ loaders, `backend/specialties/seed_firestore.py`; per-function requirements; `backend/tests/test_{config,security,backend_integration,review_fixes,case_validation}.py`.

**Consumes:** Previously tested runtime/tests at the original checkout as a source reference. **Produces:** common `protected_http`, explicit project/database/model configuration, safe query config, validation functions and protected core functions.

- [ ] Copy security/integration tests first; change only fork-specific expectations (`LIMIT 1`, deterministic SJR, non-streaming article generation). Include a no-network import guard. Run on the fork and observe real missing-guard / SQL / overwrite / startup-query failures.
- [ ] Copy the already-tested shared runtime/config and pinned dependencies; add `clinical.py` with explicit disease/event normalization. Add guards/imports to the seven mostly unchanged endpoints, preserving clinical extraction content. Merge protection into fork-specific retrieval/final code rather than replacing those files with the old implementation.

```python
from capricorn_runtime import config as runtime
from capricorn_runtime.security import protected_http
```

```python
query_job = bq_client.query(
    query, job_config=runtime.query_config([
        bigquery.ScalarQueryParameter('query_text', 'STRING', query_text)]),
    location=os.environ.get('BIGQUERY_LOCATION', 'US'))
```

- [ ] Tests require a no-case model result to stop before persona generation, case storage or query work; valid clinical fixture remains valid. Append `isClinicalCase` to the classifier's JSON schema and fail closed on false/invalid fields.
- [ ] Add bounded post-auth reference caching; preserve deterministic `lookup_journal_sjr` and reduced prompts. Tests cover missing/unknown journal without model-supplied SJR substitution.
- [ ] Use parameter-bound query text and PMC IDs, byte caps, finite retry/output caps and sanitized errors. Copy the create-only seed/write-empty loader behaviors; leave feedback disabled. Generalize final evidence language to supplied condition and report unsupported evidence instead of inventing citations.
- [ ] Run `PYTHONPATH=backend /private/tmp/capricorn-tb-venv/bin/python -m unittest discover -s backend/tests -v`. Inspect all failures; final task expectation is no core test failures and no live network use.
- [ ] Root records diff/evidence and commits this task after review; no commits while another worker stages files.

## Task 2: Bounded, validated image service (one implementation worker)

**Files:** `backend/capricorn-analyze-image/{main,imaging,findings}.py`, its `requirements.txt`, `backend/tests/test_image_{processing,endpoint,findings}.py`. Worker owns only these paths.

**Consumes:** `capricorn_runtime.protected_http/config`; shared contract above. **Produces:** `prepare_image(raw_bytes, file_name) -> (jpeg_bytes, technical_metadata)`; strict findings validation; protected `analyze_image` with documented envelope.

- [ ] First test signed CT pixels with slope/intercept and a known window, MONOCHROME1 inversion, original/preview sizes, multi-frame rejection, decompression/size limits, malformed base64, and metadata exclusion. Observe expected failures on the current fork.
- [ ] Implement pixel conversion using modality rescale before VOI/windowing, exact single-frame checks and caps before large allocation. Reject unsupported transfer syntaxes clearly; no untrusted filenames in logs or prompts. Whitelist technical metadata.
- [ ] First test invalid model JSON, missing finding states, invalid enum/type, no output and unassessable image; no fallback findings. Observe failures, then implement strict schema/validation and the outer envelope.
- [ ] Use `runtime.model_name('gemini-3.8-flash')`, limited output, response schema and draft-only phenotype prompt. Do not infer TB/resistance/treatment or whole-volume burden. Keep unknown values explicit. Add `reviewRequired: true`.
- [ ] Confirm actual entrypoint auth negative cases happen before image decoding/client construction. No real Google calls.
- [ ] Run `PYTHONPATH=backend /private/tmp/capricorn-tb-venv/bin/python -m unittest discover -s backend/tests -p 'test_image*.py' -v`; report test-first failure and final output in a task report. Do not stage/commit or touch the original checkout.

## Task 3: Frontend review gate and no-case behavior (root or next fresh worker)

**Files:** `frontend/src/utils/{request,config,caseValidation,api}.js`, focused tests; `firebase.js`, `hooks/useAuth.js`, `MedicalAssistantUI.js`, `components/MainPanel/{CaseInputSection,RadiologyFindingsCard,ExtractionSection,AnalysisSection,MainPanel}.js`, `components/Modal/ImageInputModal.js`, minimal chat component changes; `frontend/.env.example`, rules/config, `App.test.js`.

**Consumes:** shared image contract; guarded existing endpoints. **Produces:** ten configurable endpoints with fresh Firebase tokens; review-gated case input; local intro question path and honest stage status.

- [ ] Copy existing request/auth/config tests before porting the runtime client helpers; extend to `ANALYZE_IMAGE`. Test no signed-in user prevents fetch; test model-error text and no-events prose cannot initialize case, show evidence weights or trigger search.
- [ ] Introduce a case-validation helper with a local app-introduction intent (including typo-tolerant whitespace/common “who are you” forms), typed adapter support and strict no-result handling. Run red tests before implementation.
- [ ] Case input retains draft findings separately from case notes. Editing/replacing/removing the image invalidates prior confirmation. Only an explicit review confirmation appends reviewed phenotype text and enables subsequent extraction. No `hasCavity` boolean coercion of unknown states; no diagnostic “Cavitary TB” label from a cavity alone.
- [ ] Test that pending/error/nonclinical input does not show success checks; no paper fetch before findings review and evidence-weight confirmation. UI accepts selected CT slices and describes unsupported complete-series uploads accurately.
- [ ] Port actual-config Firebase initialization, named database and safe owner-scoped rules. Remove identifying debug logs and raw-input redaction fallback; a redaction failure must stop submission.
- [ ] Label canned demo clearly and remove unverified real sample files from released static assets. Verify build output has no `sample_tb_cxr.jpg` or `.dcm`; synthetic sample fixtures remain engineering-only.
- [ ] Run `CI=true npm test -- --watchAll=false --runInBand`; then `npm run build`. No model calls. Record exact failures/pass counts and warnings.

## Task 4: Reviewable staging/deployment inputs (root)

**Files:** `deploy/prepare.py`, config/example and tests; root shell wrappers; README; `docs/tb-setup-status.md`, rollback/pause notes. Reuse generator patterns from original checkout, adapting ten functions and faster fork scoring.

- [ ] Generator test first: ten sources each contain the shared runtime; image local helpers are included; no secrets/env/cache files copied; target/project/region/db/account/model/origin values validated; ordinary replacement cannot destroy an active cloud ledger.
- [ ] Add ten-function source map and model selection above. Existing cloud function names remain unchanged, with `capricorn-analyze-image` new. Use existing build account/repository/source bucket and runtime 10 for image only. Generated image memory 1 GiB, all others 512 MiB.
- [ ] Stage separate ignored `.deploy/` in fork only. Save exact apply plan and IAM delta; never run the fork's unsafe hardcoded deployment script. Keep old `.deploy/` source snapshots and actual configuration untouched.
- [ ] Check local `.env` and config ignore behavior; generic rules deny unless the reviewed allowlist is supplied. Prepare both development and production local configuration from the current Firebase metadata without printing keys.
- [ ] Run generator unittest suite, shell syntax and `git diff --check`; inspect manifest/source completeness. Copy prepared repository to the agreed permanent checkout only after local reviews pass.

## Task 5: Independent review and final deployment checkpoint (root)

- [ ] Fresh task review after each implementer's deliverable: spec compliance and code quality, with exact diff and test evidence. Read-only reviewer does not mutate cloud or source.
- [ ] One whole-branch review of fork versus `b80b609`; resolve all important issues with covering red/green tests. Verify joint contracts: image response → draft UI → reviewed text → classifier/extractors → bound SQL → TB ranking/synthesis.
- [ ] Re-run only required affected/integration tests after fixes, all ten isolated imports, meaningful unauthorized requests and named-database rule emulator checks. Build passes; no unverified public sample asset is shipped.
- [ ] Write concrete local completion report and final exact cloud-change review including additional $20 working budget. Ask only then for cloud apply authorization; no extra project or IAM confirmation afterward unless scope changes.

## Task 6: Cloud deployment and live verification (after authorization only)

- [ ] Pre-read actual current project/resources/config and save rollback snapshot without exposing keys. Create only missing image runtime account and two scoped project grants; seed TB specialty create-only. No baseline data replacement.
- [ ] Deploy protected ten-function sources with pinned dependencies, actual env and stated limits. New image function starts private. Existing services retain Firebase auth/CORS/request limits; preserve unrelated IAM with etags.
- [ ] Verify image private auth and scaling; open its approved per-service browser transport only with guard intact. Publish actual-configured frontend to the existing Hosting site and verify built artifact hash and allowed-origin preflight.
- [ ] Track counted inputs/dry-run query estimates/build reservations in a new TB ledger before each paid stage. Bounded synthetic image endpoint and reviewed phenotype literature/final checks. Browser Google login uses tokens in browser only, never pasted/exported.
- [ ] Report technical verification separately from clinical image accuracy; retain citation and feedback limits. Stop temporary local verifiers, preserve source/data/rollback and deliver real URLs/local commands/pause instructions.

## Progress ledger

- Design approved; source and original artifacts preserved.
- No task implementation has started at plan creation.
- Cloud permission/additional budget not yet approved; no paid TB work.
- Testing/review evidence goes in `docs/tb-setup-status.md` and ignored local logs.
