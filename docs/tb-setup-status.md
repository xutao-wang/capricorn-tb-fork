# TB fork setup status — October 28, 2026

**Deployed and technically verified:** https://capricorn-njms-tb-image-study.web.app
**Local:** http://localhost:3000
**Permanent checkout:** `/Users/xutaowang/Documents/Rutgers_work/capricorn-tb-fork`
**Branch:** `codex/tb-imaging-setup`, based on fork `b80b609fbda310d59fbe729bd7834f2d0e9fa86a`.

The user approved the exact cloud upgrade and additional $20 working budget. All ten functions and the image-enabled frontend are deployed. Eight bounded live checks passed; conservative reservations total $9.80, not final billing. See [deployment status](tb-deployment-status-2026-10-28.md) for use, evidence, limits and rollback.

## Local verification and review

- 136 frontend tests in15 suites; 89 backend tests including27 image tests; eight deployment/seed tests; six named-database emulator cases; ten isolated imports/50 auth/CORS checks.
- Full source/review evidence is preserved in ignored `.deploy/evidence/`. Whole-branch review approved after fixes for extraction failure handling, classification/caps, image review, stream completion, persistence failure, final-only retry and technical provenance. Small WebP provenance correction passed five covering tests and a fresh build.
- Hosting initially rejected a build directory outside Firebase’s config/project root. The generator now uses in-root `public`; a regression failed before correction, then all eight deploy tests passed. The exact16-file build was staged there and published. Independent scoped review approved; hosted hashes all match.
- Existing inherited CRA/React testing and lint advisories remain documented in task evidence; builds/tests pass. No dependency migration was added.

## Live verification

Actual uploaded source hashes, identities, env/scaling and token/origin checks passed for all ten functions. The signed-in synthetic browser checks passed for local typo introduction with zero paid API calls, strict image draft schema, server nonclinical422 rejection, article cap/chat ownership/disabled feedback, TB extraction, one-candidate/one-paper retrieval, and cited final synthesis.

Final audit:16 hosted hashes match;10functions ACTIVE; exactly the approved two project IAM additions and zero removals; all five original baseline hashes unchanged. `.deploy/final-audit.json`, `.deploy/browser-verification.json` and `.deploy/cloud-state.json` retain the details.

Original checkout, active ledger/source/env, existing data and a fresh `.deploy/rollback/` snapshot are preserved. Temporary verification harness stopped; ordinary local frontend restored with all ten actual URLs. No source push, extra project, data replacement or external email was performed.

This verifies technical behavior, not clinical imaging accuracy. CXR/selected CT slice only; complete CT series and authorized TB Portals dataset integration remain outside this release. Imaging outputs require human review. Citation coverage remains three prior test PMIDs; feedback disabled.
