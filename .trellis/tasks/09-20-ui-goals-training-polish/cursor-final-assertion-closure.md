# Cursor instruction — final assertion-only closure

Modify only the focused E2E spec/helper and regenerated evidence. Do not change production code or product behavior.

## Exact corrections

1. After rendering each day, week and month calendar at every tested viewport, assert document horizontal overflow immediately for that view. Assert the currently visible calendar has exactly the intended internal scroll container and the relevant computed `overflow-x`/`overflow-y` behavior; hidden alternate mobile/desktop selectors must not count.
2. Replace the clock check with a complete Shanghai date/time comparison. Compare month, day, hour and minute against Shanghai time, allowing only a real ±1 minute boundary including hour/day rollover. Keep the real display-name and `我` exclusions.
3. Tie training row assertions to deterministic values returned by the seed helper. For reaction, Stroop and digit span, assert the actual answer/action value, expected answer/action value and exact correctness result on both student and authorized-parent pages. Labels alone are insufficient.
4. Route every screenshot, including the three student and three parent training screenshots, through `screenshotWithTheme` or place `assertTheme` immediately before `page.screenshot` with no intervening UI operation.
5. Introduce one small `assertGoalState(card, className, exactLabel)` helper. Invoke it after every goal mutation, reload and theme switch, immediately before every active/completed/succeeded screenshot. Both candy and space evidence for every state must prove the expected class and text.

## Validation and delivery

- Preserve the existing 19 hash-pair guard, owned-file cleanup and two-project-safe seed behavior.
- Run focused Prettier, `pnpm typecheck`, `pnpm lint`, `git diff --check`, and the focused Playwright spec with both `desktop-chromium` and `mobile-360` in one run.
- Do not edit production files, task status, PRD/design/review/instruction files, `lessons.md`, `memo.md`, or `scripts/start-web-and-worker.bat`.
- Create exactly one Cursor commit for the E2E/helper/evidence correction. Then update `implementation-report.md` in the working tree with that commit SHA and truthful results; do not amend or create a second commit.
- Do not push, merge, rebase, reset or deploy. Finish with the business SHA, dirty report path, preserved user files and `已交审核`.

