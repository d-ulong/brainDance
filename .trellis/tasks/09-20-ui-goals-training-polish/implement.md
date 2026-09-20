# Implementation plan

Implement as one Cursor-owned product phase. Do not split visual work from the goal/training cross-layer work; the final browser evidence must exercise the integrated result.

## Ordered work

1. Read the task PRD/design and the required Trellis specs listed in `implement.jsonl`.
2. Inventory every status/DTO/route/UI consumer before modifying the goal union or training detail contract.
3. Add the goal schema/migration and transactional `completeGoal` command; update evaluation gating, DTOs, client helper and both student/parent UI.
4. Add protocol-owned sanitized training review projections; update session DTO/client DTO and shared result component.
5. Refactor `PageShell` identity/clock/heading-aside/back layout, then migrate affected training headings without weakening navigation guards.
6. Simplify both plan edit experiences and generation date controls while preserving hidden start-date semantics and binding authority.
7. Rebuild the calendar responsive CSS/markup and modal semantic color contract using `references/schedule-current.png` as defect evidence.
8. Add focused integration/route/E2E tests and final candy/space responsive captures.
9. Run the validation matrix below, write `implementation-report.md`, and make exactly one focused business commit.

## Required validation

Use an explicitly verified isolated test database for migration/integration tests. Never inherit a pilot database from `.env.local`.

- `pnpm test` with focused goal, migration, API and training test paths first.
- `pnpm typecheck` and `pnpm lint` because shared unions and shell props cross many consumers.
- Focused Playwright specs for the affected paths at 360/768/1440.
- `git diff --check`.
- Do not run `pnpm build` in this working directory while the pilot dev service is running. If a build is necessary, stop/restart via the project script or use an isolated checkout.

## Delivery report

`implementation-report.md` must include:

- final full commit SHA and confirmation that evidence was captured from that SHA;
- files/migrations changed;
- R01–R07 and AC01–AC10 evidence matrix;
- commands actually run with pass/fail counts;
- authorization, idempotency, concurrency and legacy-migration assertions;
- candy/space screenshots at required widths;
- any unexecuted check stated explicitly.
