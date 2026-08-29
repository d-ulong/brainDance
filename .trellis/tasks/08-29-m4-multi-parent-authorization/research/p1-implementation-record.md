# M4 P1 Implementation Record

> branch: `feat/m4-multi-parent-authorization`
>
> execution_baseline: `8603a3d6a1bd15f754c5592e909de7dbe45c5f98`

## Scope delivered (P1)

- Append-only migration `0018_m4_multi_parent_authorization.sql` with single-active-family trigger, active membership uniqueness, and relationship/membership query indexes.
- Accept flow joins an existing student family for subsequent parents; student row lock prevents concurrent first-family races.
- End flow reconciles membership only when a user has no remaining active relationships in the family; creator formal plans and point rules for the ended parent/student pair are deactivated in-transaction with audit/outbox.
- Real-time authorization remains `requireActiveRelationship`; no membership-based authorization added.

## Not delivered (explicit)

- AC-M4-4 / Reflection Privacy / private_access_grants (P2).
- redemption_catalog_items deactivation (module not present; recorded as P2+ blocker).
- UI changes, M5/M6, dependency upgrades.

## Acceptance matrix

| ID | Evidence | Notes |
| --- | --- | --- |
| AC-M4-1 | `tests/integration/family-access/multi-parent-authorization.test.ts` `AC-M4-1: second parent joins existing family and both parents retain scoped access` | Second parent shares family; both parents read profile/training |
| AC-M4-2 | same file `AC-M4-2: ending one student relationship preserves access to another student in the same family`; `AC-M4-2: ending one parent relationship preserves other parent access to the same student` | Partial membership + scoped 403 |
| AC-M4-3 | same file `AC-M4-3: last parent leaving ends student membership and re-association does not restore deactivated configs` | Plan/rule stay inactive after re-association |
| AC-M4-4 | — | P2 only; not claimed |
| AC-M4-5 | same file `AC-M4-5: relationship end is idempotent and writes audit/outbox once`; `AC-M4-5: concurrent second-parent acceptance joins one family without duplicate memberships` | Idempotent replay + concurrent accept timing |
| M1 regression | `tests/integration/family-access/end-relationship.test.ts`; `tests/integration/family-access/family-access.test.ts` | Existing suite retained |
| M2/M3 regression | full `pnpm test` | See command summary |
| DB constraints | `tests/integration/migrations/m4-schema-constraints.test.ts` | Trigger + partial unique indexes |

## Database constraints and migrations

| Name | Kind |
| --- | --- |
| `0018_m4_multi_parent_authorization.sql` | migration |
| `relationships_student_single_active_family_trg` | trigger |
| `relationships_student_single_active_family` | trigger exception constraint |
| `relationships_active_parent_student_unique` | partial unique index (existing, now in Drizzle schema) |
| `family_memberships_active_family_user_unique` | partial unique index |
| `family_memberships_user_active_idx` | partial index |
| `relationships_family_parent_active_idx` | partial index |
| `relationships_family_student_active_idx` | partial index |

## Concurrency evidence

| Scenario | Test | Timing |
| --- | --- | --- |
| Concurrent second-parent accept (same respond idempotency key) | `multi-parent-authorization.test.ts` `AC-M4-5: concurrent second-parent acceptance joins one family without duplicate memberships` | `Promise.allSettled` parallel accepts after first parent established |
| End relationship idempotent replay | `multi-parent-authorization.test.ts` `AC-M4-5: relationship end is idempotent and writes audit/outbox once` | Sequential duplicate idempotency key |

## Blockers

- `redemption_catalog_items` deactivation deferred: redemption catalog schema/module not implemented in repository (P2+ per directive).

## Changed files

- `src/db/migrations/0018_m4_multi_parent_authorization.sql`
- `src/db/migrations/meta/_journal.json`
- `src/db/schema/family-access.ts`
- `src/modules/family-access/relationship-request.service.ts`
- `src/modules/family-access/end-relationship.service.ts`
- `src/modules/family-access/membership-projection.service.ts`
- `src/modules/family-access/deactivate-creator-configs.service.ts`
- `tests/helpers/family-access.ts`
- `tests/integration/family-access/multi-parent-authorization.test.ts`
- `tests/integration/migrations/m4-schema-constraints.test.ts`
- `.trellis/tasks/08-29-m4-multi-parent-authorization/research/p1-implementation-record.md`
