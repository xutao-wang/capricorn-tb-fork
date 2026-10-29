# Final cloud review: TB imaging upgrade

Prepared locally for `njms-tb-image-study` (`1077389854176`), deployer `xw488@gcp.rutgers.edu`, October 28, 2026. **Approved by the user and deployed on October 28, 2026.** This document records the reviewed proposal; completed changes, live evidence and budget reservations are in [deployment status](tb-deployment-status-2026-10-28.md).

Read-only readiness checks confirm all nine existing functions are ACTIVE, the image runtime account and TB document are absent, the approved deployer already has project Owner, and the existing verifier role contains only `firebaseauth.users.get`. The current Hosting release has been recorded locally for rollback. No IAM/user grants were changed.

## Exact proposed changes

1. Update the nine current Capricorn Gen2 functions from this protected fork, retaining names and runtime identities 01–09.
2. Add `capricorn-analyze-image`, entrypoint `analyze_image`, runtime identity `capricorn-dev-fn-10@njms-tb-image-study.iam.gserviceaccount.com`. Create that account only if absent. Its only new project grants: `roles/aiplatform.user` and the existing `projects/njms-tb-image-study/roles/capricornTokenVerifier` (`firebaseauth.users.get`). No BQ, Firestore, DLP or storage role for images.
3. Keep all functions at min 0/max 1 instance, concurrency 1, timeout 540 seconds, Python 3.12/us-central1. Image memory 1 GiB; others 512 MiB. Verify the Firebase Google allowlist/revocation guard before adding only the image service's browser transport permission (`allUsers` Run Invoker at that service); retain/restore the equivalent existing nine service bindings after private-source verification. No project-wide public invoker.
4. Create only a missing Firestore `specialties/tuberculosis` document in `capricorn-dev` using `--specialty-id tuberculosis` and document.create. Preserve all other specialties/chats/presets and inspect any existing TB document instead of overwriting.
5. Publish the configured frontend to the **existing** site https://capricorn-njms-tb-image-study.web.app and owner-scoped rules to the existing named database. Update ignored local frontend env with the actual image URL after deployment.

Reuse the existing Firebase web app/Google provider, Hosting site, database, build identity, private source bucket, Artifact Registry repository, BigQuery datasets/remote005 embedding model/connection, PubMed corpus and journal/citation tables. No project, database, dataset, embedding-model or table replacement; no initial loaders; no SendGrid/email sending.

## Behavior and model configuration

CXR or selected single CT slice → bounded rendering → Gemini draft cavitation/consolidation/bilateral-extent/miliary states → explicit human review/edit → redacted clinical context and confirmed phenotypes → validated clinical classification/extraction → explicit evidence-weight confirmation → one-paper vector retrieval/ranking and cited synthesis. Local “Who are you?” stays outside the case pipeline.

Image/article scoring/chat/lab use `gemini-3.8-flash`; disease/events/specialty/trials use `gemini-3.1-flash-lite`; final synthesis uses `gemini-3.1-pro-preview`. Existing BigQuery `text-embedding-005` remains. The fork performs date metadata extraction within article scoring; no extra date-model call is introduced. Preserve its compact prompts, deterministic SJR lookup and `min(max(n, int(n*1.4)),25)` candidate formula.

The 5 MiB/16 megapixel/single-frame input limits, 2048 preview size, strict finding schema, auth checks and one-paper/150 GB query ceilings are verified locally. Supported uncompressed monochrome DICOM only; no complete CT series or clinical diagnostic validation. Preview/image bytes are transient and absent from persisted chat payloads. Bundled real samples are excluded from public assets.

## Additional working budget requested: $20

The earlier $20 setup allocation is already consumed/reserved ($19.998829); it is separate from this request. Reserve the additional amount in a new TB ledger before paid work, including builds/model inputs and BQ dry-run estimates. Conservatively plan approximately $2–4 for one bounded imaging plus literature/final synthetic path before free quotas, with the remaining budget available for builds and necessary retries. This is an estimate and a working ceiling, not a provider-enforced billing cap. Stop before cumulative reservations reach $20.

Run only a bounded synthetic image schema test and one synthetic TB literature/final path after counting inputs/dry-running queries, with auth/CORS/ownership checks and actual browser configuration checks. No real patient images or TB Portals download is part of this setup; authorized dataset access and clinical evaluation remain separate work.

## Rollback and evidence

Before mutation, save current function descriptions/env/IAM and the current Hosting release ID in the new TB ledger. Retain the original checkout and its active .deploy source/env/build/state. Rollback restores the earlier nine staged sources/envs/identities and previous Hosting release; leave the image service private with zero minimum instances if paused. Preserve all data.

Local verification evidence is in [tb-setup-status.md](tb-setup-status.md). Generated detailed command/IAM text is in ignored `.deploy/REVIEW-PLAN.md`. Model availability/live deployment behavior still require the bounded authorized checks. Citation coverage remains three earlier test PMIDs, and feedback is disabled.
