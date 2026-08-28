# Phase 7 Remediation Round 2

> Active task: `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Execution baseline: `7429cbfd398d0487e9942a611889c58c93b94fa4`
> Decision: **NO-GO — remediation only**

## Scope and rules

This directive contains every actionable finding from the review of the fixed baseline above. Cursor may change only `tests/e2e/training-flow.spec.ts`, `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/research/phase7-remediation.md`, and `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/research/phase7-implementation-record.md`. Do not change M2 product/UI/API/domain/migration behavior, unrelated E2E tests or helpers, dependencies, project configuration, or task history outside these two task documents. Do not start Phase 8, rebase, deploy, or claim GO.

## Findings

### P7-R03 — Required diff-check evidence remains non-zero

- **Priority:** P2
- **Basis:** `phase7-remediation.md` “Required verification and handoff” requires `git diff --check 0ca5208f9ddb86325005febb63197ac29817b480..HEAD` to exit 0; `phase7-implementation-record.md` must report factual, reproducible command evidence.
- **Files:** `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/research/phase7-remediation.md:3-6`; `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/research/phase7-implementation-record.md:52`
- **Issue:** The required command exits 1 because the four Markdown metadata lines in the remediation document end with trailing spaces. The implementation record accurately reports that failure, so the remediation quality gate itself has not been met.
- **Required change:** Remove only the line-ending spaces from `phase7-remediation.md` lines 3-6, rerun the exact required diff-check command, and update the implementation record with the factual exit-0 result. Preserve Markdown content and all existing R-ID text.
- **Verification:** `git diff --check 0ca5208f9ddb86325005febb63197ac29817b480..HEAD` exits 0; the implementation record states that exact result and the final clean status.

### P7-R05 — Remaining M1 E2E fixture loader bypasses the shared helper

- **Priority:** P2
- **Basis:** `phase7-remediation.md` P7-R04 requires shared M1/M2 E2E fixture logic; `.trellis/spec/guides/code-reuse-thinking-guide.md` requires extracting repeated code to prevent drift.
- **File:** `tests/e2e/training-flow.spec.ts:1-17`
- **Issue:** This existing M1 E2E spec still declares a local fixture type, computes the same fixture path, and parses the same JSON after `ui-helpers.ts` became the shared fixture owner. The remaining duplicate can drift when fixture fields or location change.
- **Required change:** Import and call `loadE2eFixture` from `./ui-helpers`; delete the local fixture type, `loadFixture`, and now-unused `node:fs`/`node:path` imports. Do not move API-only helpers into `ui-helpers.ts`.
- **Verification:** `pnpm test:e2e` passes every existing project; `rg` finds no local E2E fixture loader outside the shared helper; typecheck and lint pass.

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
Phase: 7 remediation round 2 — submitted for Codex review
Commit: <full SHA>
Baseline: 7429cbfd398d0487e9942a611889c58c93b94fa4
Resolved IDs: P7-R03, P7-R05
Changed files: <one per line>
Commands: <raw concise result per required command>
Blockers: <none or concrete blocker>
```
