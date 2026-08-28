# Logging Guidelines

> Logging posture and boundaries in BrainDance backend code.

---

## When This Applies

Use when deciding whether to add logs in application code, scripts, or error paths.

---

## Current Project Pattern

### No application logging library today

The `src/` tree does **not** use a structured logging library (no `pino`, `winston`, or similar). A search for `console.log`, `console.error`, and `console.warn` under `src/` returns **no matches**.

Domain services, route handlers, and modules propagate errors via thrown `*Error` classes; they do not log before throwing.

Operational visibility today comes from:

- HTTP status codes and error bodies returned to clients
- Test assertions on behavior (integration and E2E)
- Migration script stdout in `scripts/migrate.ts` only

### Scripts exception

CLI scripts may use console output for operator feedback:

```typescript
// scripts/migrate.ts
console.log("Running migrations...");
console.error(error);  // on failure
```

This is acceptable for one-off/devops scripts, not for request-handling code.

### Architectural boundaries (must follow even without a logger)

From `docs/architecture.md` §7:

- Application logs, audit logs, and monitoring metrics are **separate concerns**.
- **Do not log**: passwords, invitation codes in plain text, training answers, reflection/summary body text, private download tokens, or media links.
- Audit trail for security-sensitive actions goes through `src/modules/audit/append-audit-event.ts` inside transactions, not ad-hoc console output.

Audit usage example: `src/modules/schedule/skip-schedule.service.ts` calls `appendAuditEvent(tx, { action: "schedule_item.skipped", ... })`.

Audit coverage is tested in `tests/integration/audit/audit-coverage.test.ts`.

### Request correlation

Routes may pass `request.headers.get("x-request-id")` into services as `requestId` for audit metadata. There is no centralized request logger consuming this yet.

Reference: `src/app/api/schedule-items/[itemId]/skip/route.ts` passes `requestId` to `skipScheduleItem`.

---

## When Adding Logging Later

If a logging library is introduced:

1. Keep it out of hot domain pure functions under `src/modules/time-policy/`.
2. Log at route boundaries or worker entry points, not inside every query.
3. Follow the same redaction rules as `docs/architecture.md` §7.
4. Do not replace audit events with info-level logs.

---

## Anti-Patterns

- **`console.log` in `src/app/api` or `src/modules`** — not used today; avoid introducing without a team decision and redaction policy.
- **Logging PII or credentials** — forbidden by architecture; use audit with metadata whitelists instead.
- **Using logs as the only failure signal** — domain errors must still throw typed errors for correct HTTP responses and tests.

---

## Verification

```bash
# Confirm no console usage in application source
rg -n "console\\.(log|error|warn|info|debug)" src/

pnpm test tests/integration/audit/audit-coverage.test.ts
```
