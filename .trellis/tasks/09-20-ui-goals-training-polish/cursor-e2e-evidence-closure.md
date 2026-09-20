# Cursor instruction — final E2E evidence closure

This is a test-and-evidence closure round. Production authorization, DTOs and the new parent child-session route/page are accepted. Do not redesign them or change domain behavior.

## Required corrections

1. Extend the schedule E2E assertions across 360, 768 and 1440 for day/week/month: correct desktop/mobile selector visibility, one intentional internal scroller, no document horizontal overflow, and deterministic access to the completion modal. Keep candy/space visual captures at useful sizes; assertions must cover all three widths.
2. Prove modal focus behavior: initial focus inside, forward and reverse wrapping at the boundaries, Escape or Cancel close behavior, and restoration to the exact completion trigger. Calculate meaningful foreground/background contrast ratios for label/input/help text in both themes; simple RGB inequality is insufficient.
3. Assert the shell displays the fixture's real display name (`E2E Student` for the supplied fixture), never `我`, and a Shanghai date/time matching the current Shanghai date with a reasonable minute-boundary tolerance.
4. For reaction, Stroop and digit span, assert at least one rendered row contains the actual answer/action, expected answer/action and correctness result. Cover both student and authorized-parent pages and retain the no-horizontal-overflow assertion at 360.
5. Re-assert `html[data-theme]` after every navigation and immediately before every screenshot. Before the run, remove only the exact evidence filenames this spec owns, then require every capture to be recreated.
6. Add byte-difference guards for every candy/space pair produced by this spec: shell at each viewport, schedule day/week/month, completion modal, goal evidence and training result. A missing file must fail.
7. Cover goal card progression deterministically: active, completed/waiting evaluation, and evaluated/succeeded. Assert the exact status text and corresponding state class at each fresh read, and produce truthful candy/space evidence that demonstrates the required state styling.
8. Remove the unreachable student-plan edit branches left behind by `const editing = null`; keep the existing create behavior and standalone edit route unchanged.

## Validation

- Make the E2E seed safe for both configured Playwright projects in one serial run; it must not depend on stale database or screenshot state.
- Run the focused DB/integration tests affected by any helper change.
- Run the focused Playwright spec with **both** `desktop-chromium` and `mobile-360` projects. Do not claim success from only one project.
- Run `pnpm typecheck`, `pnpm lint`, `git diff --check` and focused Prettier checks on every file changed in this round.
- Do not run a shared-directory production build while the pilot dev server is active.

## Scope and delivery

- Do not alter the accepted API authority, training DTO semantics, goal state machine, schedule business behavior or visual design.
- Do not format unrelated files. Do not edit PRD/design/review/instruction files, task status, `lessons.md` or `memo.md`.
- Preserve the existing user-owned dirty files and the pre-existing dirty `implementation-report.md` until delivery.
- Create exactly one focused Cursor commit for test/evidence cleanup and the dead-code removal. Then update `implementation-report.md` in the working tree with that business commit SHA, actual commands/counts and exact evidence paths; do not amend or create a second Cursor commit.
- Do not push, merge, rebase, reset or deploy. Finish with the business SHA, expected dirty report path, preserved user-owned dirty paths and `已交审核`.

