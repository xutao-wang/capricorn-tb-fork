# TB imaging deployment — October 28, 2026

**Live:** https://capricorn-njms-tb-image-study.web.app  
**Local:** http://localhost:3000  
**Checkout:** `/Users/xutaowang/Documents/Rutgers_work/capricorn-tb-fork`  
**Branch:** `codex/tb-imaging-setup`  
**Project/account:** `njms-tb-image-study` / `xw488@gcp.rutgers.edu`

The approved upgrade is deployed and technically verified. Source is retained locally; no GitHub push was required.

## Use it

Sign in with the approved Google account. Upload a de-identified chest X-ray or selected CT slice, review/edit and explicitly confirm draft phenotypes, add relevant TB clinical/laboratory context, submit, confirm evidence weights, and fetch the paper and cited evidence synthesis. One displayed/scored paper is the current development cap. Failed synthesis offers a final-only retry using retained evidence.

Images become reviewed text phenotypes for PubMed literature vector search. The app does not search a TB image archive or train a diagnostic model. TB Portals access/import and clinical validation remain separate. Accepts one single-frame PNG/JPEG/WebP or supported uncompressed monochrome DICOM within5MiB/16megapixels; no complete CT series. Model observations are research drafts requiring human review, not image-only TB/resistance/treatment determinations.

## Completed changes

- Nine existing protected Gen2 functions updated, identities01–09 retained; `capricorn-analyze-image` added with identity10.
- All ten ACTIVE, Python3.12/us-central1, min0/max1/concurrency1/timeout540s. Image1GiB, others512MiB. Actual uploaded source packages match reviewed local files.
- Image account has exactly Vertex AI User and existing minimal Firebase verifier role. Project IAM diff shows exactly those two additions and no removal. Per-service browser transport remains protected by Firebase Google allowlist/revocation, CORS and ownership checks.
- Only missing `specialties/tuberculosis` created with document.create in `capricorn-dev`. Existing data/resources retained. Named-database owner rules already matched the approved policy and were retained.
- Image-enabled frontend published to existing site; all16 hosted hashes match the release. No unverified bundled CXR/DICOM sample was released. Feedback disabled; citation table still covers only three earlier test PMIDs.

## Evidence

Local:136frontend tests,89backend tests including27image cases,8deployment/seed tests,6named-database emulator cases,10isolated imports/50local guard checks. Later WebP provenance correction passed5covering tests/build; Hosting-root regression went red then all8deploy tests passed and scoped review approved.

Live: all10 actual source/identity/config/scaling checks; missing/invalid-token401, foreign-origin403 and allowed-preflight204 on each service. All eight signed-in browser checks passed:

1. Approved Google session.
2. Actual local “whoar eyou” returns introduction, calls zero paid case APIs and shows no evidence weights.
3. Synthetic image returns four validated draft findings, reviewRequired and correct original dimensions.
4. Nonclinical server input returns422 without persona initialization.
5. Two-article final payload returns400; cross-owner chat403; feedback503/disabled.
6. Redacted synthetic TB context matches existing TB specialty and yields valid findings.
7. Vector retrieval processes one candidate and displays one full-text article with terminal completion.
8. Final synthesis succeeds and cites supplied PMC evidence;6204output characters recorded, not model text.

These establish technical setup, not diagnostic accuracy. Live imaging/clinical inputs were synthetic. Raw/preview image bytes were not persisted in chats. Local tests cover explicit review, provenance whitelisting/reload, streamed errors, persistence failures, final-only retry and case/history isolation.

## Budget, local start and rollback

Conservative reservations: **$9.80 of the additional $20**, not final provider billing. Includes10build reservations, Hosting staging/retry, image/small checks, one literature path and final synthesis. Image input1373tokens; final prompt8827tokens before optional trial-result overhead. Before paid work, vector/full-text dry runs estimated133773934403/119076390449bytes, about$0.7604/$0.6769 before free quota at the [published BigQuery rate](https://cloud.google.com/bigquery/pricing). Hard ceilings remain150GB/query and1paper; these are not a provider-enforced dollar cap.

Private ignored evidence: `.deploy/cloud-state.json`, `.deploy/browser-verification.json`, `.deploy/final-audit.json`, `.deploy/live-check/cost-preflight.json`, `.deploy/image-enabled-build-manifest.json`, `.deploy/evidence/`. No keys/tokens were printed or added to Git.

The ordinary frontend is already running locally. For a later manual start:

```sh
cd /Users/xutaowang/Documents/Rutgers_work/capricorn-tb-fork/frontend
npm start
```

Use port3000 and the prepared local env files. Ctrl+C stops a server started in your own terminal. Temporary automatic verification server is stopped.

The original `/Users/xutaowang/Documents/Rutgers_work/capricorn_v2` and active .deploy remain unchanged; five baseline hashes match. `.deploy/rollback/` also holds prior nine descriptions/envs, project/service IAM, Hosting release and named-database rules. Rollback restores prior source/env and Hosting version while preserving data; image service can remain private/min0 if paused.
