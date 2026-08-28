# Error Handling

> Domain errors, propagation, and HTTP responses in BrainDance.

---

## When This Applies

Use when throwing errors from domain services, mapping them in route handlers, or adding new error codes.

---

## Current Project Pattern

### Domain error classes

Each module defines a typed error class with a string-literal `code` field:

| Module | File | Class |
|--------|------|-------|
| Identity | `src/modules/identity/errors.ts` | `IdentityError` |
| Family Access | `src/modules/family-access/errors.ts` | `FamilyAccessError` |
| Training | `src/modules/training/errors.ts` | `TrainingError` |
| Schedule | `src/modules/schedule/errors.ts` | `ScheduleError` |
| Settlement | `src/modules/settlement/errors.ts` | `SettlementError` |

Pattern (`src/modules/schedule/errors.ts`):

```typescript
export type ScheduleErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "STATE_CONFLICT"
  | "WINDOW_EXPIRED"
  | "SLOT_INVARIANT";

export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode;
  constructor(code: ScheduleErrorCode, message: string) {
    super(message);
    this.name = "ScheduleError";
    this.code = code;
  }
}
```

Services **throw** these errors; they do not return `{ ok: false }` result objects.

### Cross-module translation

When one module catches another's error and must expose a different code, translate explicitly. Example in `src/modules/schedule/skip-schedule.service.ts`:

```typescript
try {
  await requireActiveRelationship(db, actorId, item.studentId);
} catch (error) {
  if (error instanceof FamilyAccessError && error.code === "FORBIDDEN") {
    throw new ScheduleError("FORBIDDEN", error.message);
  }
  throw error;
}
```

### HTTP mapping — two response shapes

The codebase has two coexisting API error formats:

**M1 (flat)** — used by Identity, Family Access, Training routes via `src/lib/http-errors.ts`:

```json
{ "error": "Human-readable message", "code": "INVALID_CREDENTIALS" }
```

Mapper: `toErrorResponse(error)` returns `{ status, body: { error, code? } }`.

Status mapping lives in `appErrorToStatus()` in the same file (e.g. `UNAUTHORIZED` → 401, `IDEMPOTENCY_SESSION_MISMATCH` → 409).

**M2 (nested)** — used by Schedule and Settlement routes via `src/app/api/_lib/to-route-error-response.ts`:

```json
{ "error": { "code": "STATE_CONFLICT", "message": "Schedule item is not pending" } }
```

Mapper: `toRouteErrorResponse(error)` handles:

- `ZodError` → 400 `VALIDATION_ERROR`
- `ScheduleError` → per-code status via `scheduleErrorToStatus()`
- `SettlementError` → per-code status via `settlementErrorToStatus()`
- Other domain errors → flattened through `toErrorResponse()` then re-nested

When adding M2 routes, use `toRouteErrorResponse` and return `NextResponse.json(body, { status })`.

When extending M1 routes, use `toErrorResponse` directly (see `src/app/api/auth/login/route.ts`).

### Route handler pattern

```typescript
export async function POST(request: Request, context: RouteContext) {
  try {
    // auth, parse, service call
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
```

Reference: `src/app/api/schedule-items/[itemId]/skip/route.ts`.

### Input validation

- Route-level Zod schemas in route files (M1) or `src/app/api/_lib/m2-schemas.ts` (M2 shared schemas).
- Unhandled `ZodError` in M2 routes becomes 400 via `toRouteErrorResponse`.
- M1 routes should catch Zod explicitly or rely on service-layer validation that throws `IdentityError("VALIDATION_ERROR", ...)`.

### Idempotency header errors

Missing `Idempotency-Key` on M2 write routes returns 400 before try/catch:

`src/app/api/_lib/require-idempotency-key.ts` → `{ error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "..." } }`.

### Unexpected errors

Unhandled non-domain errors map to **500** with a generic message (no stack trace in response body):

```typescript
return { status: 500, body: { error: "Internal server error" } };
```

(from `toErrorResponse` fallback)

---

## Anti-Patterns

- **String matching on error messages** — branch on `error instanceof XxxError` and `error.code`.
- **Leaking internal details in 500 responses** — keep client body generic; do not expose stack traces.
- **Mixing error shapes on the same route** — M2 routes use nested `{ error: { code, message } }`; do not return flat M1 bodies from new Schedule/Settlement endpoints.
- **Silent swallow** — empty catch blocks; always rethrow or map to a domain error.

---

## Verification

```bash
pnpm test tests/integration/api/m2-routes.test.ts
pnpm test tests/integration/api/write-route-idempotency-header.test.ts
pnpm test tests/integration/schedule/schedule-auth.test.ts
pnpm test tests/integration/identity/identity.test.ts
```
