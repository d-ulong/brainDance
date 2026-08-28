# Database Guidelines

> PostgreSQL access patterns with Drizzle ORM in BrainDance.

---

## When This Applies

Use these rules when defining schema, writing migrations, or implementing queries and transactions in domain services.

---

## Current Project Pattern

### Stack

| Piece | Library / location |
|-------|-------------------|
| ORM | Drizzle ORM (`drizzle-orm`) with `postgres` driver |
| Schema | TypeScript in `src/db/schema/*.ts`, barrel export in `src/db/schema/index.ts` |
| Migrations | Hand-applied SQL in `src/db/migrations/*.sql` |
| Config | `drizzle.config.ts` — schema path, output folder, PostgreSQL dialect |
| Client | `src/db/index.ts` — singleton via `getDb()` for app; `createDb(url)` for tests |

### Schema conventions

Tables use **snake_case** column names in PostgreSQL; Drizzle field names are **camelCase** mapped to snake columns.

Example from `src/db/schema/schedule.ts`:

```typescript
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => users.id),
  status: text("status").notNull(),
  // ...
}, (table) => [
  check("plans_status_check", sql`${table.status} IN ('active', 'inactive')`),
  uniqueIndex("plans_active_formal_student_unique")
    .on(table.studentId)
    .where(sql`${table.status} = 'active' AND ${table.planKind} = 'formal'`),
]);
```

Patterns in use:

- UUID primary keys with `defaultRandom()`
- `check()` constraints for enum-like text columns
- Partial unique indexes for business invariants (one active formal plan per student)
- Idempotency columns: `create_idempotency_key`, `create_idempotency_payload_hash`
- JSON payloads in `jsonb` where needed (outbox)

Other schema references:

- `src/db/schema/identity.ts` — users, sessions (Lucia adapter tables)
- `src/db/schema/points.ts` — settlements, ledger, balance projection
- `src/db/schema/outbox.ts` — transactional outbox

### Migrations

1. Change schema TS files under `src/db/schema/`.
2. Generate migration: `pnpm db:generate` (runs `drizzle-kit generate`).
3. Apply locally: `pnpm db:migrate` (runs `scripts/migrate.ts` against `src/db/migrations/`).

Migration runner: `scripts/migrate.ts` uses `drizzle-orm/postgres-js/migrator`.

Constraint verification tests:

- `tests/integration/migrations/m2-schema-constraints.test.ts`
- `tests/integration/migrations/m2-isolated-database-lifecycle.test.ts`

Architecture note (`docs/architecture.md` §7): prefer expand → deploy → contract; add new rule/training versions rather than mutating history.

### Query patterns

Services receive `Database` (alias for `PostgresJsDatabase<typeof schema>`) as the first parameter.

Typical Drizzle usage:

```typescript
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { scheduleItems } from "@/db/schema";

const [item] = await db
  .select()
  .from(scheduleItems)
  .where(eq(scheduleItems.id, scheduleItemId))
  .limit(1);
```

Row locking for concurrent commands (`src/modules/schedule/skip-schedule.service.ts`):

```typescript
await tx.execute(
  sql`SELECT id FROM schedule_items WHERE id = ${scheduleItemId}::uuid FOR UPDATE`,
);
```

### Transactions

Multi-step commands run inside `db.transaction(async (tx) => { ... })`. The transaction handle `tx` is typed as `Database` and passed to audit/outbox helpers.

Example flow in `src/modules/schedule/skip-schedule.service.ts`:

1. `FOR UPDATE` lock on schedule item
2. Idempotency replay check
3. Insert domain event row
4. Update aggregate status
5. `appendAuditEvent(tx, ...)`
6. `appendOutboxEvent(tx, ...)` — same transaction as business write

Outbox deduplication: `src/modules/outbox/append-outbox-event.ts` uses `dedupeKey` with `onConflictDoNothing`.

### Unique violations

Use `src/lib/postgres-errors.ts` → `isPostgresUniqueViolation(error)` when translating DB conflicts to domain errors (e.g. idempotency races).

### Test database

- Integration tests use helpers in `tests/helpers/db.ts`.
- Vitest runs integration tests **serially** (`fileParallelism: false`, `maxWorkers: 1`) because they share one Postgres instance and truncate between cases — see `vitest.config.ts`.

---

## Anti-Patterns

- **Queries in route handlers** — routes call services; services own SQL/Drizzle.
- **Committing facts without outbox** — domain writes that emit events must call `appendOutboxEvent` in the same transaction (`docs/architecture.md` §4).
- **Skipping migrations** — schema TS and SQL migrations must stay in sync; CI runs `pnpm db:migrate` before tests.
- **Unbounded connection pools in scripts** — migration script uses `max: 1`; app pool uses `max: 10` in `src/db/index.ts`.

---

## Verification

```bash
pnpm db:migrate
pnpm test tests/integration/db.test.ts
pnpm test tests/integration/migrations/
pnpm test tests/integration/schedule/   # transactional command coverage
pnpm typecheck
```
