# Verification — 2026-10-17

Baseline main HEAD: `3d4c47637fb48b3f985674050342c0b73d30741c`. Existing 200+ dirty paths were retained. Feature increment is recorded against the pre-feature working tree in `source-manifest.json`, not misattributed to the entire HEAD diff.

| AC | Evidence | Result |
| --- | --- | --- |
| AC1–2 permissions / DTO | `admin-account-reset.test.ts`, `admin-account-routes.test.ts`, `password-change-access.test.ts` | Pass |
| AC3 reset and revocation | Service integration and real HTTP browser flow | Pass |
| AC4 replay / conflicts | Concurrent stale reset, UUID case/self protection, once-only plaintext, UI response-loss retry | Pass |
| AC5 all-role forced change | Central guard unit + real browser API business denial and unified routing for student, pending-verification parent and other MFA admin | Pass |
| AC6 restore / MFA / parent verification | All-role service + desktop/360 real browser flow; admin account list remains accessible after self change | Pass |
| AC7 transactional safety | pg_stat_activity-confirmed reset-first/change-first lock wait tests; injected outbox failure rolls back password/epoch/session/audit | Pass |
| AC8 UI | 14 synthetic-response UI cases, both themes and desktop/360, contrast >=4.5, no overflow, copy and once-only display | Pass |
| AC9 launcher | 4 unit cases, including actual PowerShell invocations with controlled Git commands for dirty / upstream failure / failed pull; state untouched and no pnpm calls | Pass |

Commands and scope:

- Initial serial PostgreSQL batch: four identity files, 32/32 passed. Final expanded `admin-account-reset.test.ts`: **16/16 passed**, including rollback and disabled/locked/frozen preservation. Other three files were unchanged after the initial batch.
- Pure units: account routes 8 + forced access 6 + outbox coverage 2 + Windows launcher 4 = **20/20 passed**.
- Browser UI 14 + real flow 2 = **16 distinct cases passed** across focused runs. Initial test-only failures (Next route announcer ambiguity and overlapping test fixture setup) were corrected. Final affected replay/real flows reran successfully. The real flow was rerun after assigning a separate administrator fixture so the global E2E administrator is preserved.
- `scripts/e2e-bootstrap.ts` executed successfully after replacing fictional session IDs with real initial logins.
- Full TypeScript `--noEmit --incremental false`, affected ESLint, changed-code Prettier and `git diff --check`: passed.
- No production Next build or full test/E2E suite was run; these checks were scoped to this security-sensitive feature.

Environment:

All destructive/fixture commands explicitly selected `braindance_admin_reset_test_20261017`, port 55433, with browser application port 3005. Database runners completed before final browser writes. Those temporary containers, their isolated anonymous DB volume and the temporary application image were removed after verification.

`braindance-local` Web and Worker were rebuilt using Docker Compose. PostgreSQL volume was retained. Web health returned HTTP200 `{status:ok,service:braindance}`; Web/PostgreSQL healthy and Worker running. Before/after irreversible fingerprints of existing user IDs/password hashes/must-change flags/authorization epochs matched (3 accounts); no existing account was reset.

The BAT/PowerShell pull launcher itself was not executed against this dirty real checkout: it intentionally refuses uncommitted changes. It does not manage the existing Compose services. It can only stop its own future wrappers; legacy untracked windows need one manual closure. Production database backup remains an operator prerequisite before migrations. No commit, push or production deployment was performed.

Independent trellis-check review: GO, no remaining code blocker. Frozen students' preexisting deletion capabilities remain independent narrow credentials under their original scope and expiry, without granting ordinary business access.
