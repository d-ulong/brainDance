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
| Route handlers | `src/app/api/**/route.ts` | HTTP entry: auth, Zod parsing, idempotency headers, call services, map errors |
| Domain modules | `src/modules/<domain>/` | Business logic, authorization, transactions, audit/outbox side effects |
| Database | `src/db/` | Drizzle client, schema definitions, SQL migrations |
| Shared libs | `src/lib/` | Auth helpers, HTTP error mappers, env, crypto, postgres helpers |

Domain modules mirror architecture modules documented in `docs/architecture.md` (Identity, Family Access, Training, Schedule, Settlement, Time Policy, Outbox, Audit).

### Route layer

- One file per HTTP method at `src/app/api/<resource>/route.ts` or nested dynamic segments such as `src/app/api/schedule-items/[itemId]/skip/route.ts`.
- Shared route helpers live in `src/app/api/_lib/` (Zod schemas, idempotency guard, M2 error mapper).
- Routes stay thin: validate input, call `require*Session()`, delegate to a `*.service.ts`, return `NextResponse.json`.

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

- **Business logic in route handlers** — keep routes to parsing, auth, and response mapping; put rules in `src/modules/`.
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
