# M4 P1 Implementation Record

> branch: `feat/m4-multi-parent-authorization`
>
> execution_baseline: `9e20c87b71d898641bca4be60255fd2e115279e0`
>
> remediation_baseline: `b401fc048b0047bbdc52916969f1b20fa69b6c55` (Codex NO-GO review)

## P1 consolidated remediation (P1-R01～P1-R05)

### P1-R01 — parent existing family re-use for second student

- `resolveFamilyIdForAcceptance()` now resolves **both** parent and student active families: reuse when only one side has a family; create when neither; reuse when same; reject `STUDENT_ALREADY_HAS_FAMILY` when different.
- Deterministic user row locks (`lockUsersInOrder`) replace student-only lock before family resolution.
- Tests: `P1-R01: second student joins parent's existing family…`; `…rejects acceptance when parent and student belong to different active families`; `…concurrent second-student acceptance joins one family`.

### P1-R02 — concurrent relationship end membership convergence

- `reconcileMembershipAfterRelationshipEnd()` locks `users` row (`FOR UPDATE`) before counting remaining active relationships and updating membership.
- Tests: `P1-R02: concurrent end of two student relationships converges parent membership` (two independent connections + barrier); `P1-R02: ending one of two relationships preserves active membership`.

### P1-R03 — Worker explicit handling for P1 outbox events

- Added supported-noop v1 declarations: `relationship.ended`, `plan.deactivated`, `point_rule.deactivated` in `worker-constants.ts` (state already applied in-transaction; safe delivery only).
- Tests: `outbox-worker.test.ts` `P1-R03-01/02/03`; end-flow integration processes emitted events to `processed` in `multi-parent-authorization.test.ts` `P1-R04: each deactivated plan and rule…`.

### P1-R04 — Route/session and per-item audit/outbox evidence

- New `tests/integration/api/m4-routes.test.ts`: real HTTP `POST /api/relationships/[id]/end` + `GET /api/family/students/[studentId]/profile` — 403 for ended student (no profile leak), 200 for remaining student.
- Service-level per plan/rule audit + outbox count + idempotent replay + worker processed status in `multi-parent-authorization.test.ts`.

### P1-R05 — quality gate command summary (serial, 2026-08-30 P1 DB verification)

**Database isolation:** `DATABASE_URL=postgresql://braindance:braindance@localhost:5432/braindance` (`.env.local`); Docker container `braindance-postgres` (`postgres:16-alpine`, `docker compose`, localhost:5432). Local dev/test DB only — not production or shared business DB. No concurrent test runners observed.

| Command | Exit | Summary |
| --- | --- | --- |
| `pnpm db:migrate` | 0 | Migrations complete (schema `drizzle` and `__drizzle_migrations` already exist; no pending migrations). |
| `pnpm test` | 1 | **Test Files** 4 failed \| 44 passed (48). **Tests** 6 failed \| 342 passed (348). Duration 318.58s. Failures: (1) `m4-routes.test.ts` P1-R04 — `expected 401 to be 403`; (2) `multi-parent-authorization.test.ts` P1-R02 concurrent end — `expected false to be true`; (3) `multi-parent-authorization.test.ts` P1-R04 outbox worker — `expected 'pending' to be 'processed'`; (4–5) `m2-schema-constraints.test.ts` ×2 — journal head `0018_m4_multi_parent_authorization` vs expected `0017_m3_reversal_settlement_semantics`; (6) `m3-schema-constraints.test.ts` P1-01 — same journal head mismatch. |
| `pnpm test:e2e` | — | Not executed (blocked by `pnpm test` failure). |

## Acceptance matrix (post-remediation)

| ID | Evidence | Notes |
| --- | --- | --- |
| AC-M4-1 | `multi-parent-authorization.test.ts` AC-M4-1 | unchanged |
| AC-M4-2 | AC-M4-2 cases + P1-R01 second-student + P1-R02 concurrent/single end + `m4-routes.test.ts` P1-R04 | same-family multi-student; membership convergence |
| AC-M4-3 | AC-M4-3 + P1-R04 audit/outbox per plan/rule | worker processed |
| AC-M4-4 | — | P2; not claimed |
| AC-M4-5 | AC-M4-5 + P1-R03 worker tests | idempotent + worker delivery |
| DB constraints | `m4-schema-constraints.test.ts` | re-run with DB; see P1-R05 test summary for m2/m3 head assertions |

## Worker events (P1-R03)

| event_type | version | handler |
| --- | --- | --- |
| `relationship.ended` | 1 | supported noop |
| `plan.deactivated` | 1 | supported noop |
| `point_rule.deactivated` | 1 | supported noop |

## Concurrency evidence

| Scenario | Test | Timing |
| --- | --- | --- |
| Concurrent second/third student accept | `P1-R01: concurrent second-student acceptance joins one family` | 2× `withIndependentTransaction` + barrier |
| Concurrent end two student relationships | `P1-R02: concurrent end of two student relationships converges parent membership` | 2× independent tx + barrier |
| Second-parent accept idempotency | AC-M4-5 concurrent second-parent | `Promise.allSettled` |

## Blockers

- **`pnpm test` exit 1** (6 failures in 4 files): P1-R02 concurrent end membership convergence; P1-R04 route 403 vs 401 and outbox `pending` vs `processed`; m2/m3 schema-constraint tests expect journal head `0017` but repo head is `0018_m4_multi_parent_authorization`. `pnpm test:e2e` not run.
- `redemption_catalog_items` deactivation deferred (P2+; module absent).

## Changed files (P1 consolidated remediation)

- `src/modules/family-access/relationship-request.service.ts`
- `src/modules/family-access/membership-projection.service.ts`
- `src/modules/outbox/worker-constants.ts`
- `tests/integration/family-access/multi-parent-authorization.test.ts`
- `tests/integration/api/m4-routes.test.ts` (new)
- `tests/integration/outbox/outbox-worker.test.ts`
- `.trellis/tasks/08-29-m4-multi-parent-authorization/research/p1-implementation-record.md`
