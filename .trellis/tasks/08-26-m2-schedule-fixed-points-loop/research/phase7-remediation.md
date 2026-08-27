# Phase 7 Consolidated Remediation

> Active task: `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`  
> Target branch: `feat/m2-schedule-fixed-points-loop`  
> Review baseline: `a474e72dc7d36f91d36708f3703435ec7c2482c1`  
> Reviewed Cursor SHA: `0ca5208f9ddb86325005febb63197ac29817b480`  
> Decision: **NO-GO — remediation only**

## Scope and rules

This document contains every actionable issue found in this review. Cursor may change only the Phase 7 E2E tests, the smallest shared E2E helper needed to remove duplicated flow logic, and the Phase 7 implementation record. Do not change M2 product/UI/API/domain/migration behavior, start Phase 8, add dependencies, rebase, or deploy.

## Findings

### P7-R01 — Parent path lacks final completion/today-state evidence

- **Priority:** P1
- **Basis:** `phase7-execution-directive.md` §3 and §5 require both roles to observe updated completion, balance, and today-task state.
- **File:** `tests/e2e/m2-schedule-points-flow.spec.ts:240-244`
- **Issue:** After returning to the parent plan view, the test asserts balance and ledger text only. It does not prove the parent observes the completed item or the card's today status.
- **Required change:** After the final parent navigation, assert `item-status-${itemId}` is `已完成` and `today-task-status` contains `已完成`, in addition to the existing balance assertion.
- **Verification:** Both `desktop-chromium` and `mobile-360` execute these assertions through `pnpm test:e2e`.

### P7-R02 — No-maintain guard does not cover subsequent GET/reload paths

- **Priority:** P1
- **Basis:** `phase7-execution-directive.md` §3 / §5 and `design.md` §11 prohibit maintain POST on page load or GET paths.
- **File:** `tests/e2e/m2-schedule-points-flow.spec.ts:130-242`
- **Issue:** The request listener is checked before the explicit click and immediately after it, but it is not checked after student navigation, reload, re-login, or final parent navigation. A later implicit POST would therefore pass.
- **Required change:** Keep the pre-click expected count at zero; after the explicit click and after every subsequent navigation/reload/GET path, assert the total maintain POST count remains exactly one. Retain the existing Idempotency-Key assertion for that sole POST.
- **Verification:** Run both projects with `pnpm test:e2e`; the assertions must execute on each project.

### P7-R03 — Implementation record contradicts submitted state

- **Priority:** P2
- **Basis:** `phase7-execution-directive.md` §3, §6 and §7 require executed command summaries and current git state.
- **File:** `research/phase7-implementation-record.md:45-46`
- **Issue:** The already committed submission still says `git diff --check ... 待提交后复验` and `worktree 待提交`, so the evidence is neither final nor reproducible.
- **Required change:** After completing this remediation, rerun the required commands and replace both placeholders with concise factual results, including the full remediation execution baseline and the actual clean `git status --short --branch` output. Do not claim GO.
- **Verification:** `git diff --check <baseline>..HEAD` exits 0 and the record matches the final submitted commit/worktree.

### P7-R04 — Duplicated E2E interaction helpers

- **Priority:** P2
- **Basis:** `.trellis/spec/guides/code-reuse-thinking-guide.md` requires extracting copied logic used in multiple locations.
- **Files:** `tests/e2e/m2-schedule-points-flow.spec.ts:14-59`; existing equivalents in `tests/e2e/m1-browser-flow.spec.ts` and `tests/e2e/m1-evidence-capture.spec.ts`.
- **Issue:** Fixture loading, field entry, UI login, and logout were copied into the M2 spec, creating three implementations that can drift.
- **Required change:** Extract the smallest suitable shared E2E helper (including only common fixture/form/login/logout pieces) and use it from M1 and M2 E2E specs. Preserve existing test behavior and project setup; do not introduce an application abstraction or dependency.
- **Verification:** `pnpm test:e2e` passes all existing projects and the changed M1 selector regression still passes.

## Required verification and handoff

Run serially, after ensuring port 3002 is free:

```powershell
pnpm test:e2e
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check 0ca5208f9ddb86325005febb63197ac29817b480..HEAD
git status --short --branch
```

Make one focused commit and report exactly:

```text
Phase: 7 remediation — submitted for Codex review
Commit: <full SHA>
Baseline: 0ca5208f9ddb86325005febb63197ac29817b480
Resolved IDs: P7-R01, P7-R02, P7-R03, P7-R04
Changed files: <one per line>
Commands: <raw concise result per required command>
Blockers: <none or concrete blocker>
```
