# Identity, subject access and lifecycle contracts

## 1. Scope / Trigger

Apply to subject access, session assurance, ledger mutation/rebuild, due work,
deletion/export, training visibility and parent self redemption. User decisions
dated 2026-10-16 supersede the former personal-plan zero-point policy.

## 2. Signatures

- `assertSubjectAccess(tx, subjectId, "read" | "write", now?)` accompanies resource authorization.
- `lockLedgerSubject(tx, subjectId)` precedes reading authoritative ledger or modifying its balance projection.
- `enqueueDueLifecycleWork(db, now?, batchSize?)` schedules durable `lifecycle.schedule_due`, `lifecycle.deletion_due`, `lifecycle.age_due` events.
- `POST /api/auth/login` accepts `identifier`, `password`, optional `totpCode`.
- Existing family redemption routes accept a parent acting for their own UUID as well as authorized student subjects.
- Migrations 0048–0051 add execution commands/revisions, identity assurance and signed/safe-integer ledger capacity. Never alter old applied migrations.

## 3. Contracts

- Subject writes acquire the user lock before resource locks and recheck freeze, age and live relationship in the transaction. Relationship termination acquires subject user locks before the relationship row. Ordinary student reads and writes are denied while frozen; at 19 history reads remain available and new business writes are denied. Parent personal subjects do not inherit student age restrictions.
- Administrator password success returns `{mfaRequired:true, method:"totp"}` without a session. Session creation requires a valid non-replayed TOTP step; management access requires `mfaVerifiedAt`. Session rotation preserves assurance. `ADMIN_TOTP_SECRETS` is operator-managed JSON mapping administrator UUID to Base32 secret; application code does not provision production secrets.
- Every failed password validation counts, including repeated client command keys. Only explicitly trusted proxy configuration may supply an IP rate-limit key.
- Production verification uses `VERIFICATION_DELIVERY_URL` and `VERIFICATION_DELIVERY_TOKEN`; media scanning uses the configured HTTPS relay. Missing services fail closed. Network calls have bounded timeouts, no redirects, and occur outside database transactions. Production never returns development OTP or accepts test scan bypass.
- Ledger append and balance rebuild use the same subject lock before reading. Cross-module writes use settlement interfaces. Amount and resulting balance must remain safe integers; reversal negates the exact original signed amount. History is never overwritten by ordinary correction.
- Due scans are bounded and durable. Consumers use existing outbox leases/retries/dead replay and recheck current status. Ordinary deletion needs student confirmation and `now >= revocableUntil`; explicit audited administrative force is separate. External artifact cleanup intent remains until cleanup succeeds.
- Deletion minimizes identity and new module prose/snapshots/command results while retaining numeric accounting evidence and lineage. Tombstone replay repeats minimization, including sessions and verification contacts. Export uses explicit DTO fields rather than raw table rows.
- Practice training is self-only in detail, summary and export. Summary uses a definition/age segment; trends restrict date ranges in SQL and batch metric reads. Age-band transitions apply the day after the birthday; age 19 write eligibility is separate.
- New personal plan versions retain points. Old frozen zero-point instances remain zero. Parent self redemption immediately approves and debits on self confirmation; student redemption still requires an active authorized parent. Parent self catalog items never appear in a student's shared family catalog.

## 4. Validation & Error Matrix

| Trigger | Required result |
| --- | --- |
| Frozen student, existing parent session | Sensitive read/write denied |
| Age 19 student, existing session or parent acting | New business denied; history readable |
| Admin password without TOTP | Challenge, no session |
| Same or older accepted TOTP step | No new administrator session |
| Missing production delivery/scan adapter | Explicit unavailable/error; no bypass |
| Writer interleaves with balance rebuild | Final balance equals authoritative signed sum |
| Ordinary confirmed deletion before day 30 | No deletion |
| Artifact store unavailable with pending keys | Failure with cleanup intent retained |
| Duplicate due delivery or self redemption | Idempotent result, no duplicate effects |
| Parent requests child's practice | No practice data |

## 5. Good / Base / Bad Cases

- Good: lock subject, recheck authority, append immutable fact/ledger, audit and outbox in one transaction; publish external work after commit.
- Base: self parent completes a new personal plan and redeems their own reward from their own balance.
- Bad: rebuild reads the ledger before acquiring the writer lock, or deletion clears pending external cleanup when no store is configured.

## 6. Tests Required

Use explicitly named isolated PostgreSQL databases and serial runners. Evidence:
`tests/integration/{identity,schedule,data-lifecycle}/review-remediation.test.ts`,
existing freeze/deletion/export/settlement/redemption suites and unit event-registry,
identity controls and body-redaction tests. Assert exact final balances, revision
conflicts, replay results, immutable predecessors, forbidden data absence and
cleanup retry intent; a successful HTTP response alone is insufficient.

## 7. Wrong vs Correct

```typescript
// Wrong: a concurrent writer may commit between the read and replacement.
const sum = await readLedger(tx, subjectId);
await lockLedgerSubject(tx, subjectId);
await replaceBalance(tx, subjectId, sum);

// Correct: both writers and rebuild serialize at the authority before reading.
await lockLedgerSubject(tx, subjectId);
const currentSum = await readLedger(tx, subjectId);
await replaceBalance(tx, subjectId, currentSum);
```
