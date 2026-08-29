# M3 Technical Design

## Boundaries

- `Schedule & Facts` owns manual fact versions, confirmation, correction-window authorization inputs and fact-chain queries.
- `Settlement & Ledger` owns rule evaluation, correction settlement, reversal entries and balance projection; callers never update balance directly.
- `Background Delivery` owns outbox state transitions, leases, attempts, replay and safe worker dispatch.
- Route handlers authenticate, parse and call one service; admin operations require `requireAdminSession`, parent writes require `requireVerifiedParentSession` plus `requireActiveRelationship`.

## Fact and correction flow

1. Student submits a pending `error_count` manual fact for a formal schedule item; its payload and idempotency hash are immutable.
2. An authorized parent confirms it in one transaction. The fact becomes a confirmed fact version and eligible settlement evaluates the active rule version.
3. An authorized correction command locks the source fact and its ledger effects, validates the correction window and reason, appends a successor fact version and marks the predecessor as superseded/voided by relationship rather than deletion.
4. The transaction appends a negative reversal ledger entry pointing to each prior affected entry, appends the replacement settlement/ledger, recomputes the balance projection through the ledger service, and writes audit/outbox records.
5. Uniqueness is expressed by command idempotency, fact successor uniqueness, settlement identity and a one-to-one reversal constraint; conflict races re-read the committed record.

## Schema and migration shape

- Expand `fact_versions` for manual fact command identity/confirmation semantics and make `schedule_item_id` nullable only with a constraint that M3 manual facts remain tied to formal schedule items.
- Add a durable correction relation/reason model only where existing `supersedes_fact_version_id`, audit metadata and fact value cannot prove the invariant.
- Relax the M2 ledger settlement-only check only as required for reversal entries; preserve immutable source linkage and add a unique rule preventing multiple reversal entries for one original entry per correction.
- Extend `outbox_events` with `leased_until`, lease token/owner, `attempts`, `last_error_code` and allowed lifecycle `pending | leased | processed | dead`; add `worker_attempts` with outcome/timestamps/error category/replay actor.
- Add only indexes needed for eligible-event claim, dead listing and ledger rebuild. Migrations remain expand → deploy → contract and schema TypeScript mirrors SQL.

## Worker contract

- Claim uses a single transaction and row locking/skip-locked semantics; only pending eligible or expired leased rows can be claimed.
- A handler receives event ID, type, version, payload and lease token. Completion/failure updates require the same token, preventing a late worker from overwriting a newer claim.
- Supported M3 handlers are fact-correction/points-projection events. Existing unrelated M1/M2 event types are safely acknowledged as no-op delivery records only when their schema version is explicitly supported; unknown type/version fails deterministically to retry/dead, never silently drops.
- Maximum attempts and backoff are fixed code constants for M3 and documented in the operator surface. Dead transition emits the permitted structured error event and audit; it contains no raw payload or PII.
- Admin replay only transitions a dead row into a new eligible attempt and records actor/reason. It never rewrites the event or its prior attempts.

## Projection rebuild

- CLI reads immutable ledger entries in deterministic order, computes `sum(amount)` and last entry per student, then replaces/upserts only `point_balance_projection` in a transaction.
- It supports `--student-id` for targeted repair and an all-student mode. It refuses malformed arguments and prints only operator-safe summary counts.
- Rebuild neither calls settlement nor appends outbox/audit/ledger records.

## Compatibility and rollback

- Existing M2 system completion and `points.settled` behavior remains synchronous and regression-tested; M3 adds capabilities without reinterpreting historical rows.
- Roll back by stopping the Worker and using the rebuild CLI; do not roll back migrations by deleting facts or ledger rows.
- Worker data transitions are observable through protected admin APIs and `worker_attempts`; external alert delivery is deliberately deferred.
