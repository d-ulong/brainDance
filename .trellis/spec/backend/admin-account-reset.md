# Administrator Account Reset

## 1. Scope / Trigger

Apply when changing administrator account search, credential reset, self password changes or must-change session restrictions.

## 2. Signatures

- `GET /api/admin/accounts?page=1&pageSize=20&search=&role=parent`: bounded page (pageSize 1–100, search up to 100), returns `{ items, total, page, pageSize }`.
- Item whitelist: `userId, account, displayName, role, status, mustChangePassword, authorizationEpoch`.
- `POST /api/admin/accounts/[userId]/reset-password`: `{ idempotencyKey, expectedAuthorizationEpoch }`; response `{ userId, mustChangePassword:true, authorizationEpoch, idempotentReplay, temporaryPassword? }`.
- `POST /api/auth/change-password`: `{ currentPassword, newPassword, idempotencyKey }`; response clears mustChange and carries the replacement session cookie.
- Existing user/session fields are sufficient; no new migration. Both new credential events are registered in the outbox registry.

## 3. Contracts

Require a live active administrator session, current authorization epoch, MFA, and no pending password change. Normalize UUIDs before self comparison and actor/target lock ordering. Administrator self reset is forbidden. Lock users in stable UUID order and revalidate authority within the transaction. Version mismatch is a conflict; no silent overwrite.

Secure random temporary passwords satisfy the existing product policy. Persist only Argon2 hashes. Update credentials, mustChange flag, epoch, target session revocation, audit and outbox atomically. Only the first response returns plaintext, with no-store headers. Replay validates target/version, never resets twice and never returns plaintext. Lost responses require explicit fresh reset for a new password. Preserve disabled/locked/frozen restrictions and existing TOTP material.

All normal session-protected APIs deny mustChange accounts; only own session read/logout/change are exempt. Old independent frozen-account deletion capabilities retain their existing narrow scope and expiry. Self change uses the same user lock, validates live session/current password under that lock, atomically replaces all sessions and preserves existing MFA. Replay may confirm the same current credential with a current session, but must never mint or revive a session after a later credential change.

## 4. Validation & Error Matrix

| Condition | Response |
| --- | --- |
| No live session | 401 UNAUTHORIZED |
| Non-admin, disabled/locked actor, self reset | 403 FORBIDDEN |
| Missing admin assurance | 403 MFA_REQUIRED |
| Must-change business request | 403 PASSWORD_CHANGE_REQUIRED |
| Invalid query/JSON/body/UUID | 400 VALIDATION_ERROR |
| Wrong current password | 401 INVALID_CREDENTIALS |
| Stale epoch / reused key with different reset payload | 409 STATE_CONFLICT / IDEMPOTENCY_CONFLICT |
| Missing target | 404 USER_NOT_FOUND |

## 5. Good / Base / Bad Cases

Good: reset, copy the single-use display, target logs in with its own MFA if needed, sets its own new password before business access.
Base: repeat the same reset command and receive replay metadata without a password.
Bad: cache plaintext as the idempotent result, treat an uppercase own UUID as another user, or restore MFA from a new timestamp rather than the authenticated session.

## 6. Tests Required

`tests/integration/identity/admin-account-reset.test.ts` covers whitelist pagination/search, roles/MFA/self UUID, duplicate/stale/concurrent reset, all roles, rollback, disabled/locked/frozen targets, and actual PostgreSQL lock-wait interleavings for reset versus self change. Route/guard units assert 400, no-store and explicit exceptions. `admin-account-reset-ui.spec.ts` covers mock-response UI dual themes/360; `admin-account-reset-flow.spec.ts` uses a separate explicitly named test DB and real HTTP for all three roles. Never run its seed against pilot data; never overlap it with a TRUNCATE runner.

## 7. Wrong vs Correct

```typescript
// Wrong: stale password validation outside the credential lock can overwrite a reset.
await verifyPassword(current, user.passwordHash);
await tx.update(users).set({ passwordHash: nextHash });

// Correct: lock first, verify the current session/epoch and current hash in that transaction.
await lockUser(tx, userId);
const { user, session } = await requireCredentialSession(tx, userId, sessionId);
await verifyPassword(current, user.passwordHash);
// Update credential, revoke/create sessions, audit and publish in the same tx.
```
