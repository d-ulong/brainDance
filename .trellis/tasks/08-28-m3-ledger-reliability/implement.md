# M3 Implementation Plan

Base branch and fixed planning baseline: `main` / `d78a0a9c2a16a77e9f1ca94cb9a9c6e7836101a8`. Target branch: `feat/m3-ledger-reliability`.

## Ordered Cursor stages

1. **P1 — schema and module contracts.** Add M3 migrations/schema, fact/correction and Worker domain error contracts, and constraint tests. No routes, CLI or UI.
2. **P2 — fact confirmation and correction.** Implement services, rules/settlement reversal path, protected API routes and focused integration/API tests. No Worker consumption or UI.
3. **P3 — outbox Worker operations.** Implement leasing/retry/dead/attempts/replay, admin dead/replay APIs and Worker tests. No third-party notifications.
4. **P4 — projection rebuild.** Implement the protected operator CLI and rebuild tests; verify no business side effects.
5. **P5 — cross-layer verification.** Update acceptance matrix and implementation evidence, run complete serial quality gates, then submit for Codex final audit.

Every stage receives a separate Codex directive with the fixed parent SHA, requirement IDs, allowed files, prohibited scope, definition of done, verification commands and required report format. A later stage must not begin without a Codex GO commit.

## Verification matrix

- P1: `pnpm db:migrate`; M3 migration constraint tests; `pnpm typecheck`.
- P2: focused facts/settlement integration tests; M3 API authorization/idempotency tests; regression `tests/integration/settlement/settlement-ledger.test.ts`.
- P3: Worker lease/retry/dead/replay integration tests; outbox transaction regression; admin API tests.
- P4: rebuild CLI integration tests, ledger/balance regression and a no-side-effects assertion.
- P5: `pnpm db:migrate`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`, and relevant `pnpm test:e2e` if API changes affect browser flows.

## Review gates and rollback points

- Before P2: verify P1 migration schema, constraints and error surface against M3-R01–R03.
- Before P3: verify correction writes fact/audit/outbox atomically and the ledger reversal is exactly once.
- Before P4: verify Worker attempt state can be audited without logging payload/PII.
- Before final GO: serially re-run the full suite if concurrent shared-DB runs occurred; map every AC-M3 row to a test or explicitly uncovered item.
- Rollback uses a Worker stop plus projection rebuild; no `git reset`, SQL deletion or historical record overwrite is permitted.
