# Quality Guidelines

> Code quality gates and testing expectations for backend work in BrainDance.

---

## When This Applies

Before submitting backend changes: run the relevant commands below and add tests when behavior changes.

---

## Current Project Pattern

### Toolchain

| Gate | Command | Config |
|------|---------|--------|
| Unit + integration tests | `pnpm test` | `vitest.config.ts` |
| Type safety | `pnpm typecheck` | `tsconfig.json` — `strict: true`, `@/*` path alias |
| Lint | `pnpm lint` | `eslint.config.mjs` — Next core-web-vitals + TypeScript + Prettier compat |
| Format check | `pnpm format` | Prettier via `prettier --check .` |
| Production build | `pnpm build` | Next.js 15 App Router |
| E2E (API + browser) | `pnpm test:e2e` | Playwright — see frontend quality guidelines for UI scope |

ESLint ignores: `.next/`, `node_modules/`, `src/db/migrations/**`, `.trellis/**`, `docs/**`.

### Testing layers

**Unit tests** — `tests/unit/**/*.test.ts`

- Pure logic, no database: time policy, schedule helpers, env parsing.
- Examples: `tests/unit/time-policy/completion-window.test.ts`, `tests/unit/schedule/effective-status.test.ts`.

**Integration tests** — `tests/integration/**/*.test.ts`

- Real PostgreSQL; helpers in `tests/helpers/db.ts`, `tests/helpers/identity.ts`, `tests/helpers/schedule.ts`.
- Run **serially** (single worker) to avoid TRUNCATE races — configured in `vitest.config.ts`.
- Global setup: `tests/global-setup.ts`; per-file setup: `tests/setup.ts` (loads env, sets `SESSION_SECRET`).

Coverage areas with backend examples:

| Area | Test file |
|------|-----------|
| DB connectivity | `tests/integration/db.test.ts` |
| Identity / auth | `tests/integration/identity/identity.test.ts` |
| Schedule commands | `tests/integration/schedule/schedule-complete.test.ts`, `schedule-skip.test.ts` |
| Idempotency headers | `tests/integration/api/write-route-idempotency-header.test.ts` |
| M2 route matrix | `tests/integration/api/m2-routes.test.ts` |
| Outbox in transaction | `tests/integration/outbox/outbox-transaction.test.ts` |
| Settlement / ledger | `tests/integration/settlement/settlement-ledger.test.ts` |

**E2E tests** — `tests/e2e/*.spec.ts` (Playwright)

- Exercise full stack including API routes from browser or `request` fixture.
- Example: `tests/e2e/m2-schedule-points-flow.spec.ts` — plan creation, schedule complete, points balance.

### Required patterns for behavior changes

1. **New domain error codes** — extend the module's `errors.ts` and the HTTP mapper (`src/lib/http-errors.ts` or `src/app/api/_lib/to-route-error-response.ts`).
2. **New write routes** — M2-style routes require `Idempotency-Key` header; test idempotency and conflict paths.
3. **Schema changes** — add migration SQL + integration test for constraints if adding invariants.
4. **Authorization** — test forbidden/unauthorized paths (`tests/integration/schedule/schedule-auth.test.ts` is the reference style).

### Forbidden patterns

- **`any` in new code** — TypeScript strict mode is enabled; use proper types from Drizzle `$inferSelect` / `$inferInsert`.
- **Skipping migration on schema change** — breaks `pnpm db:migrate` in CI and other developers.
- **Parallel integration tests that mutate shared tables** — vitest is intentionally single-worker; do not raise `maxWorkers` without isolated DB per worker.
- **Direct Lucia/session logic duplicated in routes** — use `src/lib/auth-request.ts`.

### Full verification bundle

M1 remediation script (includes migrate, test, typecheck, lint, format, build, e2e):

```bash
pnpm verify:m1-remediation
```

Minimum backend-focused gate before review:

```bash
pnpm db:migrate && pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

---

## Code Review Checklist

- [ ] Route is thin; logic in `src/modules/` service
- [ ] Errors use module error class + code; HTTP mapper updated
- [ ] Writes that emit events include audit + outbox in same transaction
- [ ] Migration present if schema changed
- [ ] Integration or unit test covers happy path and at least one failure/authorization path
- [ ] No secrets or PII in logs (see logging guidelines)
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` pass

---

## Verification

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```
