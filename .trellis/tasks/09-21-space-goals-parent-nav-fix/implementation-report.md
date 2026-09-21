# Implementation report

## Root cause and changes

- Space theme: portaled dialogs were outside `.bd-shell`, leaving `StudentMultiSelect` with a literal white surface and light inherited text; Tailwind `text-slate-*` also overrode schedule explanatory text. The selector now uses theme tokens directly, slate gray utilities map to the theme muted token, and the space muted color is brighter.
- Parent navigation: the `workspace="parent"` branch forced desktop top tabs into a left column. The branch and prop were removed so all desktop roles use the shared horizontal top navigation.
- Goals 500: the running database lacked migrations 0045/0046 while the current service selected their completion columns. The Windows production launcher now runs migration, rebuilds the current checkout, and only then starts web and worker.

## Verification

- Missing-column repro: `select completed_by, completed_at from goal_assignments` failed with PostgreSQL 42703 before migration.
- Explicit isolated DB migration: passed; both completion columns present.
- `tests/unit/deployment/start-web-and-worker.test.ts`: 1/1 passed.
- `tests/integration/api/goals-and-plan-library-routes.test.ts`: 3/3 passed.
- `tests/e2e/space-theme-parent-shell.spec.ts --project=desktop-chromium`: 1/1 passed; computed contrast ≥ 4.5, horizontal parent nav, goals GET 200.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with 0 errors and 6 pre-existing warnings.
- Focused Prettier and `git diff --check`: passed.
- `pnpm build`: passed.
