# Directory Structure

> How backend code is organized in BrainDance.

---

## When This Applies

Use this layout when adding API routes, domain services, database schema, or shared server utilities.

---

## Current Project Pattern

Backend responsibilities are split across four top-level areas under `src/`:

| Area | Path | Responsibility |
|------|------|----------------|
| Route handlers | `src/app/api/**/route.ts` | HTTP entry: auth, Zod parsing, idempotency headers, service delegation (preferred), map errors |
| Domain modules | `src/modules/<domain>/` | Business logic, authorization, transactions, audit/outbox side effects |
| Database | `src/db/` | Drizzle client, schema definitions, SQL migrations |
| Shared libs | `src/lib/` | Auth helpers, HTTP error mappers, env, crypto, postgres helpers |

Domain modules mirror architecture modules documented in `docs/architecture.md` (Identity, Family Access, Training, Schedule, Settlement, Time Policy, Outbox, Audit).

### Route layer

- One file per HTTP method at `src/app/api/<resource>/route.ts` or nested dynamic segments such as `src/app/api/schedule-items/[itemId]/skip/route.ts`.
- Shared route helpers live in `src/app/api/_lib/` (Zod schemas, idempotency guard, M2 error mapper).

**Preferred direction for new behavior:** validate input, call `require*Session()`, delegate transactional business rules and domain invariants to a `*.service.ts`, return `NextResponse.json` or `Response.json`. Schema/domain invariants and transactional side effects belong in `src/modules/`, not in route handlers.

**Observed M1 exceptions (do not copy for new work):** several existing routes still perform route-local Drizzle reads or orchestration instead of pushing every read through a service:

| Route | Route-local behavior |
|-------|---------------------|
| `src/app/api/auth/register/route.ts` | After `registerParent`, runs `db.select().from(users)` to shape the response body |
| `src/app/api/auth/session/route.ts` | `GET` runs `db.select().from(users)` for session payload fields |
| `src/app/api/relationship-requests/route.ts` | `GET` queries `relationshipRequests` directly for the student's pending list |

These are legacy M1 seams, not a pattern to extend. New routes should follow the M2-style service delegation in `src/app/api/schedule-items/[itemId]/skip/route.ts`.

Reference routes:

- M2 write route with idempotency: `src/app/api/schedule-items/[itemId]/skip/route.ts`
- M1 auth route with flat error body: `src/app/api/auth/login/route.ts`
- Health check: `src/app/api/health/route.ts`

### Domain module layer

Each domain folder typically contains:

| File pattern | Purpose |
|--------------|---------|
| `*.service.ts` | Command/query functions accepting `Database` as first argument |
| `errors.ts` | Typed error class + string-literal error codes |
| `constants.ts` | Domain constants (optional) |

Examples:

- `src/modules/schedule/skip-schedule.service.ts` — transactional command with row lock, audit, outbox
- `src/modules/identity/login.service.ts` — session creation
- `src/modules/family-access/authorization.service.ts` — relationship checks

Cross-cutting helpers used inside services:

- `src/modules/audit/append-audit-event.ts`
- `src/modules/outbox/append-outbox-event.ts`
- `src/modules/time-policy/*` — family-date and completion-window calculations (pure or DB-agnostic)

### Database layer

- Schema barrel: `src/db/schema/index.ts` re-exports domain schema files (`identity.ts`, `schedule.ts`, `points.ts`, etc.).
- Client singleton: `src/db/index.ts` exports `getDb()`, `createDb()`, `closeDb()`.
- Migrations: numbered SQL files in `src/db/migrations/` (e.g. `0013_schedule_horizon_maintains.sql`).

### Auth boundary

Session enforcement is centralized in `src/lib/auth-request.ts`:

- `requireAuthenticatedSession()` — any logged-in user
- `requireAdminSession()`, `requireParentSession()`, `requireStudentSession()` — role gates
- `requireVerifiedParentSession()` — parent with verified contact
- `requireStudentSessionForWrites()` — student allowed to mutate (password-change guard)

Routes import these; services receive `actorId` and enforce resource-level authorization themselves.

---

## Directory Layout

```text
src/
├── app/api/
│   ├── _lib/                  # Shared route schemas and helpers
│   ├── auth/                  # Login, register, session, verify-contact
│   ├── family/students/       # Family-scoped reads and writes
│   ├── schedule-items/        # M2 schedule commands
│   ├── training/sessions/     # Training session lifecycle
│   └── ...
├── db/
│   ├── index.ts
│   ├── schema/
│   └── migrations/
├── lib/
│   ├── auth-request.ts
│   ├── http-errors.ts
│   ├── env.ts
│   └── postgres-errors.ts
└── modules/
    ├── identity/
    ├── family-access/
    ├── training/
    ├── schedule/
    ├── settlement/
    ├── time-policy/
    ├── outbox/
    └── audit/
```

---

## Naming Conventions

| Kind | Convention | Example |
|------|------------|---------|
| Route file | `route.ts` in App Router folder | `src/app/api/auth/login/route.ts` |
| Service file | `<verb>-<noun>.service.ts` or `<noun>.service.ts` | `skip-schedule.service.ts`, `login.service.ts` |
| Error file | `errors.ts` per module | `src/modules/schedule/errors.ts` |
| Schema file | Domain noun, snake_case table names in SQL | `src/db/schema/schedule.ts` → table `schedule_items` |
| Path alias | `@/` → `src/` | `import { getDb } from "@/db"` |

---

## Anti-Patterns

- **Business logic in route handlers** — schema/domain invariants and transactional behavior belong in `src/modules/`. New routes should not add route-local query orchestration like the M1 exceptions above; keep routes to parsing, auth, and response mapping.
- **Direct cross-module table writes** — callers use another module's service or shared authorization helper, not ad-hoc updates to foreign tables.
- **Bypassing auth helpers** — do not read cookies or Lucia sessions manually in routes; use `src/lib/auth-request.ts`.
- **Schema changes without migration** — always add a SQL migration under `src/db/migrations/`; do not rely on `drizzle-kit push` in this project.

---

## Verification

```bash
pnpm typecheck          # Path alias and imports resolve
pnpm lint               # ESLint over src/ (migrations and .trellis ignored)
pnpm test               # Unit + integration cover modules and routes
```

Integration examples tied to module boundaries:

- `tests/integration/schedule/schedule-skip.test.ts`
- `tests/integration/identity/identity.test.ts`
- `tests/integration/api/m2-routes.test.ts`
