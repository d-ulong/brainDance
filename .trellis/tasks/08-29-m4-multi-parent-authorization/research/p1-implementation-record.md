# M4 P1 Implementation Record

> branch: `feat/m4-multi-parent-authorization`
>
> execution_baseline: `f69fd87e731e6afef9e7d4fa806ffb50c345f68e`
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

### P1-R05 — quality gate command summary (serial, 2026-08-30)

| Command | Exit | Summary |
| --- | --- | --- |
| `pnpm db:migrate` | 1 | `DrizzleQueryError`: `CREATE SCHEMA IF NOT EXISTS "drizzle"` → `AggregateError ECONNREFUSED` (::1:5432, 127.0.0.1:5432). Docker Desktop daemon not running; `docker compose up -d` failed (`dockerDesktopLinuxEngine` pipe missing). |
| `pnpm test` | 1 | Not executed (blocked): `tests/global-setup.ts` → `migrateTestDb()` same `ECONNREFUSED`. No files/tests/skip counts available. |
| `pnpm typecheck` | 0 | `tsc --noEmit` clean. |
| `pnpm lint` | 0 | 0 errors, 3 pre-existing warnings (`playwright.config.ts` `_nodeEnv`; `scripts/run-e2e.mts` `logPortStatus`, `_nodeEnv`). |
| `pnpm format` | 0 | `prettier --check .` — All matched files use Prettier code style. |
| `pnpm build` | 0 | `next build` compiled successfully; static pages generated. |
| `pnpm test:e2e` | 1 | Not executed (blocked): e2e runner requires app + DB; same Postgres unavailable (`ECONNREFUSED`). |

## Acceptance matrix (post-remediation)

| ID | Evidence | Notes |
| --- | --- | --- |
| AC-M4-1 | `multi-parent-authorization.test.ts` AC-M4-1 | unchanged |
| AC-M4-2 | AC-M4-2 cases + P1-R01 second-student + P1-R02 concurrent/single end + `m4-routes.test.ts` P1-R04 | same-family multi-student; membership convergence |
| AC-M4-3 | AC-M4-3 + P1-R04 audit/outbox per plan/rule | worker processed |
| AC-M4-4 | — | P2; not claimed |
| AC-M4-5 | AC-M4-5 + P1-R03 worker tests | idempotent + worker delivery |
| DB constraints | `m4-schema-constraints.test.ts` | not re-run (DB unavailable) |

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

- **Postgres unavailable locally**: Docker Desktop not running; all DB-backed verification blocked until `docker compose up -d` (or equivalent) succeeds and quality gates re-run serially.
- `redemption_catalog_items` deactivation deferred (P2+; module absent).

## Changed files (P1 consolidated remediation)

- `src/modules/family-access/relationship-request.service.ts`
- `src/modules/family-access/membership-projection.service.ts`
- `src/modules/outbox/worker-constants.ts`
- `tests/integration/family-access/multi-parent-authorization.test.ts`
- `tests/integration/api/m4-routes.test.ts` (new)
- `tests/integration/outbox/outbox-worker.test.ts`
- `.trellis/tasks/08-29-m4-multi-parent-authorization/research/p1-implementation-record.md`
