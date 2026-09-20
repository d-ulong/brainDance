# Cursor instruction — evidence and authorized-parent training review fix

This is one final bounded correction round for the defects documented in `review-f95cb5a.md`. Do not revisit accepted B01–B07 behavior or redesign unrelated screens.

## Required production result

1. Add a thin, explicit family-scoped read route for a parent's authorized student training session detail. Reuse `requireStudentReadAccess` (or the established equivalent) at request time, then load the student's completed session through the training service. An active relationship may read the sanitized `trialReview`; an inactive/revoked relationship, another parent and unrelated student must be rejected. Never expose raw training event payloads.
2. Add the matching parent child-session result page and a discoverable link from `parent/students/[studentId]/training`. Reuse `TrainingSessionReview`; keep the disclaimer in the title aside and preserve the student-context banner/navigation guard conventions.
3. Keep the existing parent-personal training detail route/page for the parent's own exercises. Do not weaken it by making an arbitrary `studentId` query parameter authoritative.
4. Remove the newly exposed unused `fromDefinition` and unused `setEditing` only if they are genuinely dead after the final implementation.

## Required deterministic tests

1. Extend the training service/route matrix with all of these explicit assertions: reaction, Stroop and digit-span completed reviews; active, cancelled and protocol-invalid completed sessions return no review; active linked parent can read the child's review; revoked/inactive relationship cannot; unrelated parent/student cannot; response has no raw payload fields.
2. Fix `tests/e2e/ui-goals-training-polish.spec.ts` so it never uses `if (isVisible)` to make required behavior optional. Seed or create the exact plan, schedule item, active goal and three completed training sessions needed by each case; required locators must fail when absent.
3. Select themes through the real theme toggle or the shared `braindance-theme` contract. Apply/persist the theme before navigation and assert `html[data-theme]` again after every navigation and immediately before capture. Add a guard that candy/space evidence for the same viewport is not byte-identical.
4. Cover at 360, 768 and 1440 as required: real name/Shanghai clock, inline back row, plan hierarchy without plan start-date controls, today-to-today inputs, day/week/month without duplicate selectors or document overflow, completion modal focus trap/restoration and readable computed colors, goal complete -> student fresh read -> responsible-parent evaluation -> parent fresh read, and the three training answer-review UIs including the authorized parent path.
5. Capture final candy and space evidence for schedule day/week/month, completion modal, goal status cards and training result, not only an empty plan shell. Every path named in the report must exist.

## Evidence and validation

- Use only an explicitly verified isolated `*_test_*`, `*_isolated_*` or `*_e2e_*` database for migrations, resets and E2E fixtures.
- Run the focused migration/goal/training/API tests, the corrected Playwright spec, `pnpm typecheck`, `pnpm lint`, and `git diff --check` on the final code.
- Do not claim optional/skipped assertions as coverage. Record exact test counts and all screenshot paths.
- Do not run `pnpm build` in the shared directory while the pilot dev server is active.

## Delivery and repository ownership

- Preserve the existing user-owned changes in `lessons.md`, `memo.md`, and `scripts/start-web-and-worker.bat`; do not stage, edit or revert them.
- Do not edit the PRD, design, prior reviews, task status, `lessons.md` or `memo.md`.
- Make exactly one focused Cursor business commit for code, tests and evidence. After that commit, update `implementation-report.md` in the working tree with that commit's full SHA and truthful results, but **do not amend or make a second Cursor commit**. Codex will audit and commit the report as mechanical bookkeeping if the code passes.
- Do not push, merge, rebase, reset, deploy or start another phase.
- Finish with the business commit SHA, the one expected dirty report path, preserved user-owned dirty paths, and `已交审核`.

