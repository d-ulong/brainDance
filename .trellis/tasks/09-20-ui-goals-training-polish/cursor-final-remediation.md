# Cursor final remediation instruction

This is the only instruction for the final remediation. Fix every blocker B01–B09 in `review-970ad290.md` without changing the acceptance line.

## Handoff

- Active task: `.trellis/tasks/09-20-ui-goals-training-polish`
- Branch: `main`
- Exact launch baseline SHA is supplied in the user-facing launch prompt.
- Expected pre-existing user-owned changes are supplied in that prompt and must not be modified or staged.
- Read `prd.md`, `design.md`, `implement.md`, `cursor-instruction.md`, `review-970ad290.md`, both JSONL manifests, and the screenshot before editing.

## Required result

1. Restore a visible inline back/title row on every `backHref` page, including former `hideHeading` call sites, while preserving navigation guards.
2. Fetch session once, put Shanghai clock immediately left of the real name, and remove the duplicated student-home date.
3. Remove plan-level start-date controls from all create/edit/copy paths; preserve/default the hidden fact correctly and finish responsive form footers.
4. Allow today-to-today generation without UI clamping; validate order locally and show binding-boundary server errors.
5. Complete the calendar and completion-dialog redesign, including modal-scoped contrast for portaled content in both themes.
6. Enforce paired completion fields for new terminal goals while preserving both-null legacy terminals.
7. Complete the goal route/service/concurrency/auth matrix and the reaction/Stroop/digit-span session review matrix.
8. Move the parent training hub's compact instructions/disclaimer into the title aside.
9. Add/run focused E2E and capture required candy/space evidence at 360/768/1440.

## Boundaries

- Preserve `pending_approval -> active -> completed -> succeeded|failed`, manual schedule generation, binding authority, existing reward/ledger semantics, training scoring and raw-answer secrecy.
- Keep routes thin and writes/command result/audit/outbox/ledger/projection atomic.
- Do not rewrite historical terminal facts, expose raw event payloads, weaken modal/navigation behavior, or introduce optimistic terminal UI.
- Do not edit task status, PRD, design, review/instruction files, `lessons.md` or `memo.md`. If those user-owned files contain changes, leave them untouched.
- Do not push, merge, rebase, reset, deploy, change credentials or start another phase.

## Tests and evidence

- Use an explicitly verified isolated `*_test_*`, `*_isolated_*` or `*_e2e_*` database. Never run destructive setup against `braindance` or a pilot database.
- Run focused migration/goal/API/training tests, typecheck, lint and `git diff --check`.
- Add and run focused Playwright for 360/768/1440. Cover both themes and assert no document horizontal overflow, visible back controls, fresh-read goal state, modal focus/contrast, and per-type answer rows.
- Do not run build in the shared directory while the pilot dev server is active.

## Delivery

- Produce exactly one focused remediation commit containing code, migration correction, tests, screenshots and a corrected `implementation-report.md`.
- The report must identify original SHA `970ad29022f76b2624c43a03a3d4f52cc5455d22`, final remediation SHA, B01–B09 evidence, actual commands/results and screenshot paths.
- Do not claim a command passed unless it ran successfully on the final code. Finish with the full SHA and “已交审核”; do not declare GO.
