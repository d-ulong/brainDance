# Phase 8 Consolidated Remediation

> Active task: `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Execution baseline: `60a094d5e3b3c2ae13ae76278415aefce59221a3`
> Decision: **NO-GO — remediation only**

## 1. Scope and rules

This directive contains every actionable finding from the fixed-SHA review above. Cursor may change only:

- `tests/integration/schedule/formal-plan.test.ts`
- `research/m2-verification-matrix.md`
- `research/phase8-final-verification.md`

Do not change product code, migrations, schemas, routes, UI, E2E or other tests/helpers, dependencies, configuration, prior phase records, frozen IDs, or task history. Do not archive, merge, deploy, start another milestone, or claim final GO. Make one focused remediation commit and state only “submitted for Codex final review”.

## 2. Findings

### P8-R01 — NF-8 evidence checked an empty committed diff (P1)

- **Basis:** `phase8-execution-directive.md` §§3, 5–6 require factual command evidence and a successful diff-check covering the Phase 8 change; `AGENTS.md` §§4–5 require verifiable outcomes and evidence equivalent to implementation.
- **Location:** `research/phase8-final-verification.md` quality-gate table; `research/m2-verification-matrix.md` NF-8 and quality-gate summary.
- **Issue:** The package says `git diff --check 184d829...HEAD` was run while HEAD still equalled the baseline, so it checked an empty committed diff and cannot support the Phase 8 document change. Codex independently ran the exact command at committed SHA `60a094d5e3b3c2ae13ae76278415aefce59221a3` and obtained exit 0, but the package does not distinguish that valid post-commit evidence from Cursor’s ineffective pre-commit run.
- **Required change:** Correct the two documents to state the original pre-commit limitation and record Codex’s independent fixed-SHA result without representing it as Cursor evidence. For this remediation, run both `git diff --check` for the working tree before commit and `git diff --check 184d82964281d50e2cab1faaac053b9612cecf6c..HEAD` after the remediation commit; report the post-commit result in the required handoff. Do not claim that an uncommitted document was covered by a commit-range command.
- **Verification:** Both checks exit 0; the handoff reports the exact post-commit command/result and the documents accurately distinguish evidence ownership/timing.

### P8-R02 — NF-1 E2E arithmetic is internally inconsistent (P2)

- **Basis:** the directive requires locateable, unambiguous evidence for every NF ID.
- **Location:** `research/phase8-final-verification.md` §5.1 M1 E2E row.
- **Issue:** The row claims 10/10 but enumerates `home×2 + m1-browser-flow×4 + training-flow×2`, which totals 8. The actual 12-test listing proves M1 contributes 10 cases: `home.spec.ts` 2 tests × 2 projects = 4, `m1-browser-flow.spec.ts` 2 tests × 2 projects = 4, and `training-flow.spec.ts` 1 test × 2 projects = 2.
- **Required change:** Correct the evidence notation to `home.spec.ts` ×4, `m1-browser-flow.spec.ts` ×4, and `training-flow.spec.ts` ×2, preserving total 10/10.
- **Verification:** The §4 E2E table, §5.1 arithmetic, and raw Playwright listing agree exactly.

### P8-R03 — F8 lacks create/edit transaction evidence (P1)

- **Basis:** `prd.md` F8 requires create, edit, and maintain write transactions to call/persist expired items; the directive forbids marking a row passed without locateable evidence.
- **Location:** `research/m2-verification-matrix.md` F8 row.
- **Issue:** The cited direct persist service test, F28 maintain test, and F7 complete path do not prove that the create and edit transactions invoke expiration persistence. Source calls are not test evidence.
- **Required change:** Add exactly two focused integration cases to `tests/integration/schedule/formal-plan.test.ts`: one proves a successful create transaction persists an eligible past pending item for the same student as `expired`; one proves a successful edit transaction does the same. Each case must assert the precondition is `pending`, invoke the public create/edit service path, assert `expired` afterward, and use deterministic family-time data. Do not refactor production code or broaden test coverage. Update F8 to cite both exact test names plus the existing maintain evidence.
- **Verification:** The two focused cases pass and F8 has locateable create/edit/maintain evidence.

### P8-R04 — F10 omits enable-rule replay/hash evidence (P1)

- **Basis:** `prd.md` F10 covers edit, deactivate, and enable-rule same-key replay plus payload-hash mismatch.
- **Location:** `research/m2-verification-matrix.md` F10 row.
- **Issue:** The row cites only edit and deactivate tests even though it marks all of F10 passed.
- **Required change:** Add the existing `tests/integration/settlement/settlement-ledger.test.ts` cases `enable point rule replays same rule on same key with single audit/outbox (F11-F13/P4-R2-04)` and `rejects enable point rule replay with mismatched payload hash (P4-R06)` as locateable evidence. Do not rename or modify those tests.
- **Verification:** F10 explicitly maps edit, deactivate, enable-rule replay, and enable-rule mismatched-hash behavior.

### P8-R05 — Failure-path family count excludes F9b (P2)

- **Basis:** the frozen matrix and `prd.md` contain F1–F28 plus F9b; the directive requires all of them, including stable IDs.
- **Location:** `research/phase8-final-verification.md` requirement-family evidence map and any related count statements.
- **Issue:** The package reports 28 failure-path items while also including F9b, so the actual row count is 29.
- **Required change:** State `F1–F28 including F9b` and count 29 everywhere the family count appears. Do not renumber or remove F9b.
- **Verification:** The declared count equals the 29 matrix rows and all IDs remain stable.

## 3. Required verification and handoff

Ensure port 3002 is free, then run serially:

```powershell
pnpm test:e2e
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check
git status --short --branch
```

Commit once, then run:

```powershell
git diff --check 184d82964281d50e2cab1faaac053b9612cecf6c..HEAD
git status --short --branch
```

Report exactly:

```text
Phase: 8 remediation — submitted for Codex final review
Commit: <full SHA>
Baseline: 60a094d5e3b3c2ae13ae76278415aefce59221a3
Resolved IDs: P8-R01, P8-R02, P8-R03, P8-R04, P8-R05
Changed files: <one per line>
Commands: <raw concise result per required command, including post-commit diff-check>
Unverified: <none or exact IDs/boundaries>
Blockers: <none or concrete blocker>
```
