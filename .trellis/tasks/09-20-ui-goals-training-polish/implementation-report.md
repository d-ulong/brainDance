# Implementation report — final remediation

## SHA

- **Original implementation SHA**: `970ad29022f76b2624c43a03a3d4f52cc5455d22`
- **Remediation baseline SHA**: `95da8c1d99d1fbbc0bdfd210d03ffd03c1cac5dd`
- **FINAL_SHA**: `ec4663a4232bc2ee996f06550ecd720a4fb91753`

## B01–B09 evidence

| ID | Evidence |
|----|----------|
| B01 | `PageShell` uses `showPageHeading = !hideHeading \|\| backHref`; inline `page-back-link` + title row preserved with guards. E2E: `tests/e2e/ui-goals-training-polish.spec.ts` asserts back on `/student/plans`. |
| B02 | Single session fetch in `PageShell`; `ShellIdentityCluster` horizontal clock + name; removed `bd-home-eyebrow` from `student-home-dashboard.tsx`. E2E: `shell-display-name`, `shell-shanghai-clock`. |
| B03 | Removed visible plan-level start date from student modal, parent copy modal, formal plan create; new/copy uses Shanghai today internally; edit retains stored value via `plan-library-edit-form` ref; balanced `bd-plan-edit-footer` grids. |
| B04 | Parent/student generate modals: `min=today`, local `through >= from` only, binding errors from server; `data-testid` generate from/through. E2E today-to-today check. |
| B05 | Desktop hides toolbar date input (`globals.css`); segmented `schedule-completion-mode`; balanced modal footer; calendar day/week/month E2E. |
| B06 | Modal-scoped field/input/placeholder/disabled/help colors in `globals.css`; `Field`/`TextInput` semantic tokens. |
| B07 | Migration `0046_goal_completion_pair_terminal.sql` + Drizzle check; `goal-completed-constraints.test.ts` legacy + both half-pair directions on terminal states. |
| B08 | Extended `goal-complete.test.ts`, `goal-complete-route.test.ts`, `training-session-review-matrix.test.ts`, `training-review.test.ts`; parent training hub copy in `headingAside`. |
| B09 | `tests/e2e/ui-goals-training-polish.spec.ts` run at 360/768/1440 × candy/space; screenshots under `references/e2e-remediation/`. |

## Commands and results

| Command | Result |
|---------|--------|
| `DATABASE_URL=postgresql://…/braindance_test pnpm exec drizzle-kit migrate` | Applied through `0046_goal_completion_pair_terminal` |
| `DATABASE_URL=…/braindance_test pnpm exec vitest run tests/unit/training/training-review.test.ts tests/integration/migrations/goal-completed-constraints.test.ts tests/integration/goals/goal-complete.test.ts tests/integration/api/goal-complete-route.test.ts tests/integration/training/training-session-review-matrix.test.ts tests/integration/settlement/goals-and-manual-penalties.test.ts` | **21/21 passed** |
| `pnpm typecheck` | **passed** |
| `pnpm lint` | **passed** (0 errors, existing warnings) |
| `git diff --check` | **passed** |
| `E2E_SUPERVISED=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:3003 DATABASE_URL=…/braindance_test pnpm exec playwright test tests/e2e/ui-goals-training-polish.spec.ts` | **18/18 passed** (supervised `next dev -p 3003`, not `pnpm build`) |
| `pnpm build` | **not executed** (avoid `.next` replacement while shared dev workflow) |

## Screenshot paths

- `.trellis/tasks/09-20-ui-goals-training-polish/references/e2e-remediation/shell-{candy|space}-{360|768|1440}.png`
- `.trellis/tasks/09-20-ui-goals-training-polish/references/e2e-remediation/schedule-completion-modal-space-1440.png` (when a completable schedule item exists)

## Not executed

- Production `pnpm build` in shared workspace.
- Playwright via default `next start` webServer (no production build artifact); used supervised dev server instead.
