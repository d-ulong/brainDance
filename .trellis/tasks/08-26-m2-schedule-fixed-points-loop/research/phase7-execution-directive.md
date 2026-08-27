# Phase 7 Execution Directive — M2 E2E

## 1. Fixed handoff

- **Active task:** `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
- **Target branch:** `feat/m2-schedule-fixed-points-loop`
- **Signed Phase 6 implementation:** `352bb0224fdb7f51f798af92dea4ca3d0dfa0789`
- **Execution baseline:** the commit that adds this directive and `phase6-signoff.md`; report its full SHA exactly.
- **Single goal:** implement and run the Phase 7 desktop-Chromium and mobile-360 M2 end-to-end flow. Do not start Phase 8.

## 2. Required reading

1. `prd.md`: **“Web 与 E2E”**, AC-M2-7 and non-functional requirements.
2. `design.md` §11 and §7.1; `implement.md` §2.3, §4.3, §10 and §11.
3. `research/phase6-signoff.md` §3; `research/m2-verification-matrix.md` §3.

## 3. Allowed scope

- Create/update only `tests/e2e/m2-schedule-points-flow.spec.ts` and test-support/bootstrap files strictly required to make this scenario deterministic.
- Cover the same seven-step path on desktop Chromium and a 360×800 mobile project: parent login, plan create, explicit point-rule enable, explicit maintain-horizon invocation, student login, pending item completion, then parent/student balance and today-task confirmation.
- Assert page load and GET paths do not issue `POST .../maintain-horizon`; after the explicit button click assert exactly one such POST and a non-empty `Idempotency-Key` header.
- Assert completed state and +10 balance outcome; keep evidence locateable by test name and expectation.
- Update `research/phase7-implementation-record.md` with executed projects, command summaries, cases, and any reproducibility notes.

## 4. Prohibited scope

- Do not modify migrations, database schema, M2 domain services, route contracts, or Phase 6 product UI except a minimal testability correction that is first documented as a blocker in the report.
- Do not change Phase 1–6 acceptance records, add product functionality, add dependencies, rebase, deploy, or start Phase 8.
- Do not replace E2E with manual-only evidence or claim final M2 GO.

## 5. Completion definition

1. Both desktop and mobile-360 projects execute the complete M2 flow successfully.
2. The test proves the maintain endpoint is never called on initial render/GET and is called exactly once only after explicit user activation, with `Idempotency-Key`.
3. The test proves the student sees a pending item, completion succeeds, and both role paths observe the updated completion/balance/today-task state.
4. All relevant E2E evidence is deterministic and no assertions rely on fixed implementation-only IDs.
5. `phase7-implementation-record.md` states only “submitted for Codex review”, never GO.

## 6. Required verification

```powershell
pnpm test:e2e
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <execution-baseline>..HEAD
git status --short --branch
```

If shared services cause an E2E failure, isolate and rerun serially before classifying it. Preserve the raw concise output in the implementation record.

## 7. Commit and report

Make one focused commit. Then report exactly:

```text
Phase: 7 E2E — submitted for Codex review
Commit: <full SHA>
Baseline: <full execution baseline SHA>
Resolved IDs: AC-M2-7, NF-2, NF-7 / <exact checklist IDs>
Changed files: <one per line>
Commands: <raw concise result per required command>
Blockers: <none or concrete blocker>
```
