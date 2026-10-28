# TB fork setup status — October 28, 2026

The approved local design is implemented on `codex/tb-imaging-setup`, based on requested fork commit `b80b609fbda310d59fbe729bd7834f2d0e9fa86a`. Cloud apply and the additional $20 working budget remain pending. No TB-phase cloud mutation, model call or paid query has occurred.

The original checkout and its active `.deploy/`, configuration, source and data are retained. Five baseline hashes still match `/private/tmp/capricorn-tb-original-baseline.json`. Working checkout: `/private/tmp/capricorn-tb-fork-inspect-20261028`; verified permanent checkout: `/Users/xutaowang/Documents/Rutgers_work/capricorn-tb-fork`.

## Local verification evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Backend unit/integration suite | 89 pass, including 27 image tests | `/private/tmp/capricorn-tb-backend-fix-full-green.log` |
| Frontend unit/interaction suite | 136 pass in 15 suites | `/private/tmp/capricorn-tb-final-full.log` |
| Deployment preparation/target-only seed | 8 pass | `/private/tmp/capricorn-tb-prepare-green.log` |
| Existing seed-mode compatibility | 1 pass after selector addition | `/private/tmp/capricorn-tb-seed-compatibility-green.log` |
| Staged imports and actual auth/CORS entrypoints | 10 isolated imports, 50 checks; zero paid operations | `/private/tmp/capricorn-tb-staged-imports-green.json` |
| Named `capricorn-dev` rule emulator | 6 pass, loopback demo project, stopped cleanly | `/private/tmp/capricorn-tb-rules-green.log` |
| Pinned isolated Python dependencies | pip check: no broken requirements | `/private/tmp/capricorn-tb-venv` |
| Actual-env production build | exit 0; 16 hashed files; zero unverified CXR/DICOM samples | `/private/tmp/capricorn-tb-frontend-final-build.log`, ignored `.deploy/build-manifest.json` |
| Shell syntax / diff whitespace / source key-pattern filenames | pass / clean / no matches | local commands recorded in task reports |

No test invokes a real Google model, BQ query, patient image, external email or live Firebase database. Tests cover strict clinical adapters (including failure envelopes and dotted terminology), no-case/persona rejection, SQL binding/caps, DICOM signed modality→VOI/window→MONOCHROME rendering, invalid draft schema, token/revocation/allowlist/origin/owner restrictions, explicit draft/weight review, and exclusion of raw/preview image bytes from persisted chat payloads.

The real-component synthetic interaction follows MedicalAssistantUI → MainPanel → CaseInputSection → RadiologyFindingsCard → chat initialization → EvidenceWeightsReview → exactly one retrieval. Pending/unreviewed/nonclinical paths cannot persist or fetch. Additional real-adapter tests now cover article/completion streams, deferred persistence, visible final failure, a final-only retry without another search, stale/new case isolation and historical no-case status. Actual live model/browser behavior still requires the bounded authorized check.

## Independent reviews

- Backend including image: spec and quality approved after extraction/parser/classifier/cap/default-model fixes. `/private/tmp/capricorn-tb-backend-review.md` and fix report `/private/tmp/capricorn-tb-backend-fix-report.md`.
- Frontend: important extraction-adapter issues fixed; scoped re-review approved. Joint review/weight/persistence test added. `/private/tmp/capricorn-tb-frontend-review.md`; implementation/red-green evidence `/private/tmp/capricorn-tb-frontend-task-report.md`.
- Deployment preparation: spec and quality approved, no important findings. `/private/tmp/capricorn-tb-deploy-review.md`; evidence `/private/tmp/capricorn-tb-deploy-task-report.md`.
- Whole-branch final review found three lifecycle issues and missing technical provenance. All four are repaired in `21065ea`; supported WebP format preservation in `cae613f`. Re-review confirms no Important findings remain; final report `/private/tmp/capricorn-tb-whole-review.md`. Fix evidence `/private/tmp/capricorn-tb-final-fix-report.md`.

Minor debt: inherited unused declarations/React hook lint warnings, CRA Babel/Browserslist advisories, RTL13 act deprecation, compressed inherited/touched handlers, and expected CLI/emulator/argparse diagnostics. The new extraction helper and follow-up test files have zero ESLint findings. No warnings were hidden and no dependency migration was added.

## Prepared deployment inputs

Ignored `.deploy/evidence/` preserves the task reports, reviews and concise local verification summaries. Read-only `.deploy/preflight-readonly/` confirms nine ACTIVE functions, absent image runtime/TB document, current Hosting release, existing Owner deployer and exact minimal verifier role.

Ignored `.deploy/` contains ten source snapshots with shared runtime and image helpers, explicit per-service env, minimal owner rules, current Hosting target, model/identity review manifest, detailed upgrade-only plan and local verification/build hashes. Actual Firebase configuration and nine current URLs are in ignored frontend development/production env; the new image URL is deliberately empty until authorized deployment. `--replace` now refuses active/unknown/edited output trees. Both root shell wrappers generate local review files only.

Models: Flash3.8 for image/article/chat/lab; 3.1FlashLite for extractors/detector/trials; 3.1Pro preview for final; existing005 embedding. The fork extracts article date metadata during the compact article scoring call; no additional date-model call exists. Hard cap one paper and 150 GB/query, min0/max1/concurrency1, image1Gi and others512Mi, timeout540s. Preserve existing SJR lookup and 1.4× pool formula.

## Remaining work and approval

1. Finalize the review report, then prepare the permanent checkout and local dependencies from the reviewed branch.
2. Ask for the exact [cloud delta and additional $20 budget](tb-cloud-upgrade-review.md), with current source/build/rollback reviewable. The initial $20 is already reserved/consumed; no further paid work under it.
3. After approval: snapshot actual cloud state, create only missing image identity/two roles, deploy ten protected functions, create only missing TB specialty, publish actual configured build/rules to existing site, perform bounded counted/dry-run synthetic checks and record a new spend ledger.
4. Verify actual deployment and browser behavior; deliver real URLs/local commands and pause/rollback notes. No duplicate project, source push, data replacement or additional design confirmation.

This is technical setup evidence, not clinical imaging validation. General vision outputs are draft research observations requiring human review; no image-only TB/resistance/treatment conclusion. Complete CT series and authorized TB Portals data integration remain outside this release. Citation coverage remains three prior test PMIDs and feedback is disabled.
