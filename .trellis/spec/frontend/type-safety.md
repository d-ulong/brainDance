# Type Safety

> TypeScript and DTO conventions for frontend code in BrainDance.

---

## When This Applies

Use when typing pages, components, and client API responses.

---

## Current Project Pattern

### Compiler settings

From `tsconfig.json`:

- `strict: true`
- `allowJs: false`
- Path alias: `@/*` → `./src/*`
- JSX: `preserve` (Next.js handles transform)

Run `pnpm typecheck` (`tsc --noEmit`) before submitting changes.

### Props and local types

Component props are **inline types** in the same file:

```typescript
// src/components/m2/points-today-card.tsx
type PointsTodayCardProps = {
  studentId: string;
  studentName?: string;
  planHref?: string;
};
```

Page-local types for API slices:

```typescript
// src/app/page.tsx
type LinkedStudent = {
  studentId: string;
  displayName: string;
};
```

No separate `types/` folder for frontend DTOs today.

### Client DTOs — `src/lib/client/`

**Shared session/API types** — `src/lib/client/api.ts`:

- `SessionInfo`
- `ApiError` class with `status` and optional `code`

**M2 response shapes** — exported from `src/lib/client/m2-api.ts`:

```typescript
export type ScheduleItemDto = {
  id: string;
  planId: string;
  familyDate: string;
  effectiveStatus: string;
  // ...
};

export type PointsBalanceDto = {
  balance: number;
  lastLedgerEntryId: string | null;
  updatedAt: string | null;
};
```

When adding M2 endpoints, extend `m2-api.ts` with the response type and a typed wrapper function using `apiFetch<T>`.

Generic fetch:

```typescript
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>
```

Login page uses inline generic on call site:

```typescript
await apiFetch<{ userId: string; contactVerified: boolean }>("/api/auth/login", { ... });
```

### Error body parsing

`ApiError` accepts both M1 flat and M2 nested error shapes (`src/lib/client/api.ts`):

```typescript
type ApiErrorBody = {
  error?: string | { code?: string; message: string };
  code?: string;
};
```

Frontend code typically checks `err instanceof ApiError` and displays `err.message`.

### Runtime validation boundary

**Zod runs on the server** in route handlers and `src/app/api/_lib/m2-schemas.ts`, not in client components.

Client trusts typed `apiFetch` responses; forms use HTML5 validation (`required` on inputs) and manual checks before submit.

Do not add client-side Zod unless a task explicitly requires it — not the current pattern.

### Shared domain types

Some client modules import pure functions from server modules for consistency:

```typescript
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
```

Used in `src/lib/client/m2-api.ts` for `todayFamilyDate()`. Only import **pure** module code that does not touch DB or secrets.

### Forbidden patterns

- **`any`** — avoid in new code; use explicit DTO types or `unknown` with narrowing.
- **Unchecked `as` casts on API JSON** — prefer generic parameter on `apiFetch<T>` or typed wrapper in `m2-api.ts`.
- **Duplicating DTO types** — define once in `m2-api.ts` and import in pages/components.

---

## Anti-Patterns

- **Generating types from OpenAPI** — not set up; manual DTO types match current routes.
- **Importing Drizzle schema types in components** — keep DB types on server; expose JSON shapes via API types in `lib/client`.

---

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test tests/integration/api/m2-routes.test.ts   # server contract tests
```

Cross-check DTO fields against route JSON in integration tests when adding new endpoints.
