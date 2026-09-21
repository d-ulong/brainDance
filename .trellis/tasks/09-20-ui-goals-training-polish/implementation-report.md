# Implementation report — final assertion closure

## SHA

- **Review baseline SHA**: `f91fc467b76356b1ab523a659faf75b555f25bfe`
- **Prior reviewed SHA (NO-GO)**: `e15fbbc22250d25317b0e7cc8becada6e87bb13a` (per `review-e15fbbc.md`)
- **BUSINESS_SHA**: `e6d40256843240f796cde49db779f3f2e24ec2c5`

## Assertion remediation (review-e15fbbc)

| ID | Fix evidence |
|----|----------------|
| E01 | After each day/week/month render at 360/768/1440: immediate `expectNoHorizontalScroll`, visible mobile vs desktop calendar surface, vertical day scroller / horizontal week scroller / month `overflow-x: hidden` on `.bd-calendar`; hidden alternate layout nodes excluded. |
| E03 clock | Shanghai month/day plus hour+minute compared via minutes-of-day with ±1 wrap-aware tolerance; display name `E2E Student` and exclusion of `我` unchanged. |
| E03 review rows | Seed exports `trainingReview` expectations; reaction/stroop/digit-span assert exact `dd` values for action/expected/correctness on student and parent pages. |
| E04 | All training PNGs use `screenshotWithTheme` (theme assert immediately before capture). |
| E05 | `assertGoalState(card, className, exactLabel)` before every active/completed/succeeded candy/space screenshot, including post-theme-switch captures. |

Codex final review tightened the Shanghai clock assertion to compare the full displayed month/day/hour/minute against the ±1 minute Shanghai window, and applied `assertGoalState` after the student and parent fresh reads as well as immediately after evaluation.

## Commands and results

| Command | Result |
|---------|--------|
| `pnpm exec prettier --check tests/e2e/ui-goals-training-polish.spec.ts tests/e2e/ui-goals-training-polish-helpers.ts` | **passed** |
| `pnpm typecheck` | **passed** |
| `pnpm lint` | **passed** (0 errors, 6 pre-existing warnings) |
| `git diff --check` (staged E2E/evidence) | **passed** |
| `E2E_SUPERVISED=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:3003 DATABASE_URL=postgresql://braindance:braindance@localhost:5432/braindance_test pnpm exec playwright test tests/e2e/ui-goals-training-polish.spec.ts --project=desktop-chromium --project=mobile-360` | **56/56 passed** (28 desktop-chromium + 28 mobile-360; supervised `next dev -p 3003` + lifecycle worker) |

Codex independently reran focused Prettier, typecheck, lint, both diff checks, and the same two-project Playwright command after the final assertion tightening. The final result remained **56/56 passed** in 5.8 minutes.

## Candy / space PNG hash check (all 19 pairs DIFF)

| Pair | Candy SHA-256 (prefix) | Space SHA-256 (prefix) |
|------|------------------------|-------------------------|
| shell @ 360/768/1440 | `57246c2…` / `7f75ae2…` / `e411e95…` | `93085e2…` / `73fe574…` / `deed6fa…` |
| schedule-day @ 360/768/1440 | `4143258…` / `3223a2b…` / `d1aace5…` | `e8d692c…` / `8805320…` / `1863680…` |
| schedule-week @ 360/768/1440 | `7cc47bb…` / `86aba8f…` / `42d32c1…` | `54af1b4…` / `a193ac1…` / `6c0265e…` |
| schedule-month @ 360/768/1440 | `25e2ca0…` / `ebca6d8…` / `e5057d6…` | `8eab6ad…` / `17d8d3f…` / `06d36b1…` |
| schedule-completion-modal @ 360/768/1440 | `7234ba8…` / `78b97f2…` / `5636c13…` | `1687c51…` / `7c92319…` / `871ffb9…` |
| goal-active / completed / succeeded @ 768 | `418811b…` / `8b6ef8a…` / `fff1e1a…` | `5348533…` / `cd1f1ea…` / `daab11f…` |
| training-result @ 1440 | `37298e4…` | `8cb0aa0…` |

Full hashes verified in spec test `all candy and space evidence pairs differ`.

## Screenshot paths (under `.trellis/tasks/09-20-ui-goals-training-polish/references/e2e-remediation/`)

- Shell: `shell-{candy|space}-{360|768|1440}.png`
- Schedule: `schedule-{day|week|month}-{candy|space}-{360|768|1440}.png`
- Completion modal: `schedule-completion-modal-{candy|space}-{360|768|1440}.png`
- Goals: `goal-{active|completed|succeeded}-{candy|space}-768.png`
- Training: `training-student-{reaction|stroop|digit-span}-360.png`, `training-parent-{reaction|stroop|digit-span}-768.png`, `training-result-{candy|space}-1440.png`

## Not executed

- `pnpm build` in shared workspace (pilot dev on 3003).
