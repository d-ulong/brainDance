# M7 P2 Architecture Rework Record

## Fixed object

- Active task: `.trellis/tasks/09-02-m7-family-push-pilot`
- Directive: `research/p2-architecture-rework-directive.md`
- Seal correction directive: `research/p2-seal-correction-directive.md`
- Branch: `feat/m7-family-push-pilot`
- Execution baseline SHA (seal correction): `494fb564945ec7322d450e66aeba5633f3c47053`
- Corrected implementation SHA (pre-seal): `4b0421c0b925f4a6253f5bf86a3f99edbc1a0975`
- Prior rework baseline (context only): `3df50b370e4753dd432c804474c32b602ead660b`
- Scope: MediaPurge fail-closed, MediaUpload single-flight, MediaMigrationGate pre-migrate orchestration, focused evidence corrections

## AR-01 MediaPurge fail-closed

### Interface

- Caller: `handleMediaPurgeRequestedV1(db, event, mediaStore)` — process purge event; retryable; fail closed.
- Hidden internals: `prepareMediaPurge` → external `purgeSafe`/`purgeStaging` → `finalizeMediaPurge`.
- Removed restore path: `releasePurgeOwnership` no longer restores `ready`/`revoked` after ownership.

### Invariants

1. Once prepare takes ownership (`status=purging` + intent `prepared` + matching `owned_generation`), any `purgeSafe` / `purgeStaging` / finalize throw is uncertain and keeps ownership.
2. Same generation idempotent retry re-enters physical delete + finalize.
3. Attach may cancel only `pending` intents before ownership; prepared/purging blocks attach/capability reopen.
4. Stale finalize without ownership is a no-op; never restores readable state.

### Failure matrix (SC-03 — four independent objects)

Each scenario captures `expectedGeneration` after mid-state ownership and passes it into
`assertPurgeConverged`. Convergence asserts `media.purgeGeneration === expectedGeneration`
and completed intent `ownedGeneration === null` (retry did not reclaim a new generation).
Evidence is the persisted generation, not merely replaying the same outbox event payload.

| Independent case | Mid-state | After same-generation retry |
|------|-----------|-------------|
| `purgeSafe` throw-before-delete | purging + prepared + owned_generation; attach rejected; capabilities unreadable | purged + completed; `purgeGeneration` unchanged; audit=1; refs=0; live caps=0; objects gone |
| `purgeSafe` delete-before-throw | bytes may be gone; still purging/prepared; attach rejected | purged + completed; `purgeGeneration` unchanged; audit=1; replay stable |
| safe ok / staging fail | safe gone; staging error category; ownership held | purged + completed; `purgeGeneration` unchanged; audit=1 |
| physical ok / finalize fail | objects gone; `finalize_failed`; ownership held | purged + completed; `purgeGeneration` unchanged; audit=1 |

## AR-02 MediaMigrationGate

### Publish boundary (Git evidence)

Commands:

```text
git ls-tree -r main --name-only -- src/db/migrations/0029_m7_family_media.sql
git ls-tree -r main --name-only -- src/db/migrations/0030_m7_media_student_binding.sql
git ls-tree -r main --name-only -- src/db/migrations/0031_m7_media_purge_fencing.sql
git show main:src/db/migrations/meta/_journal.json
git tag -l
```

Result: `0029`/`0030`/`0031` are **absent** from `main` and from all release tags (no tags present). Main journal ends at `0027_m6_deletion_capabilities`. These migrations remain pre-release lineage on this branch only. No migration files were renumbered, merged, or deleted.

### Gate interface

- Module: `src/db/media-migration-gate.ts`
- Orchestration: `src/db/run-migrations-with-media-gate.ts` (production entry via `scripts/migrate.ts`)
- `assertMediaMigrationCompatibility(client)` compares applied `drizzle.__drizzle_migrations.hash` (by journal `when`) to current SQL SHA-256 (same algorithm as drizzle-orm).
- **SC-01**: gate runs **before** `migrate()`; optional post-check remains after migrate; `try/finally` always closes the connection.
- On mismatch: `MediaMigrationCompatibilityError` with explicit “rebuild non-production development database” guidance.
- Does **not** drop/reset/TRUNCATE user databases; does **not** claim revised SQL re-executed.

### Upgrade / compatibility tests

| Test | Result |
|------|--------|
| Git evidence: 0029–0031 absent from main/tags | pass |
| Fresh install through 0031 | pass |
| `main` tip (`0027`) → branch final schema once | pass |
| Recorded old `0030` checksum → gate fails; drizzle skip of revised SQL observed | pass |
| **SC-01** production orchestration with old `0030` checksum → fails before mutate; `0031` columns/constraints/ledger absent | pass (seal correction) |

## AR-03 Test seams (no production hooks)

Removed from production modules:

- `setMediaUploadFinalizeFailureHookForTest` (`media-upload.service.ts`)
- `setFamilyContentDeletionTxFailureHookForTest` (`account-deletion.service.ts`)

Replacement (tests only, cleaned in `finally` / `afterEach`):

- Temporary Postgres trigger on `media_objects` status→`ready` for finalize TX failure
- Temporary Postgres trigger on `audit_events` insert for `family_content.purged`
- Temporary trigger on status→`purged` for purge finalize failure
- Media store adapter overrides for purgeSafe/purgeStaging uncertainty

Tests still call the same production module entrypoints (`uploadFamilyMedia`, `handleMediaPurgeRequestedV1`, `purgeFamilyContentBodiesForStudent`).

## AR-04 Non-vacuous evidence (corrected)

- Pixel bomb: fixture creation failure fails the test; upload path runs and leaves `rejected` + `scanErrorCategory=reencode_failed`.
- **SC-02** Concurrent same-key/same-payload upload: independent connections + barrier; both calls return the same ready mediaId; exactly one created + one idempotent replay; one media row; one `media.uploaded` audit. Does **not** accept `MEDIA_UNAVAILABLE` / `MEDIA_REJECTED` / “at least one success”.
- Concurrent different payload same key: exactly one success + one `IDEMPOTENCY_CONFLICT` + one ready row.
- Concurrent duplicate attach: independent transactions + barrier; one success, one definite unique/`FamilyContentError`; `referenceCount=1`; one active purpose ref.
- Upload single-flight: injectable `MediaUploadIdempotencyLock` (`media-upload-idempotency-lock.ts`) using `pg_advisory_lock(hashtext(media.upload:{actor}:{key}))` via `sql.reserve()` on the **same** shared Postgres authority as `db` (production: `getSharedSqlClient()` / `getRouteMediaUploadIdempotencyLock()`; tests: `getTestSqlClient()`). Domain module does not import `postgres` / `requireDatabaseUrl` or create per-request connections. Lock covers the full upload pipeline; scan/reencode/object I/O stay outside DB transactions.

## Seal correction (SC-01～SC-03)

| ID | Change | Evidence |
|----|--------|----------|
| SC-01 | `runMigrationsWithMediaCompatibilityGate` gates before `migrate()`; connection closed in `finally` | `src/db/run-migrations-with-media-gate.ts`, `scripts/migrate.ts`, test `SC-01: production migrate orchestration…` |
| SC-02 | Upload idempotency advisory lock + strict concurrent assertions | `media-upload.service.ts`, concurrent block in `family-media.test.ts` |
| SC-03 | Four independent purge failure `it`s with mid-state/capability/retry/audit/replay matrix | `SC-03:*` tests in `family-media.test.ts` |

## Final seal remediation (same-DB lock + generation proof)

| Blocker | Change | Evidence |
|---------|--------|----------|
| Upload lock same DB authority | `MediaUploadIdempotencyLock` + `createPostgresMediaUploadIdempotencyLock(sql)`; route binds `getSharedSqlClient()`; tests bind `getTestSqlClient()`; no per-request pool in domain | `media-upload-idempotency-lock.ts`, `route-media-stores.ts`, `src/db/index.ts` `getSharedSqlClient`, concurrent SC-02 + lock adapter tests |
| SC-03 same-generation retry | `assertPurgeConverged({ expectedGeneration })` asserts `media.purgeGeneration` and completed intent did not reclaim | four `SC-03:*` tests each pass captured mid-state generation |

## Changed files (seal correction + final remediation)

- `src/db/run-migrations-with-media-gate.ts` (new)
- `scripts/migrate.ts`
- `src/db/index.ts` (`getSharedSqlClient`)
- `src/modules/family-content/media-upload-idempotency-lock.ts` (new)
- `src/modules/family-content/media-upload.service.ts`
- `src/modules/family-content/route-media-stores.ts`
- `src/app/api/family/students/[studentId]/media/route.ts`
- `tests/helpers/db.ts` (`getTestSqlClient`)
- `tests/integration/family-content/family-media.test.ts`
- `tests/integration/family-content/media-upload-idempotency-lock.test.ts` (new)
- `tests/integration/migrations/m7-media-student-binding.test.ts`
- `research/p2-architecture-rework-record.md` (this file)

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/family-content/family-media.test.ts` | exit 0 — **12/12 passed** |
| `pnpm test -- tests/integration/family-content/media-upload-idempotency-lock.test.ts` | exit 0 — **2/2 passed** (same run: 14/14) |
| `git diff --check` | clean |

### Not run (per final seal remediation directive)

- Migration tests / full test suite
- typecheck / lint / format / build
- E2E
- Milestone gate

---

## Upload connection ownership rework (new stage)

- Directive: `research/p2-upload-connection-ownership-directive.md`
- Execution baseline SHA: `0562cf4dec8c73649ac8f1f58c26dd63f5ae8a8e`
- Scope: same-key single-flight connection ownership + pool forward progress under saturation. Does **not** change P2 product range, purge, migration gate, or capability behavior. Does **not** rewrite prior seal conclusions above.

### Connection ownership

1. `MediaUploadIdempotencyLock.withLock` callback receives `lockedDb: Database`.
2. `createPostgresMediaUploadIdempotencyLock(sharedSql)` calls `sharedSql.reserve()` once; grafts drizzle session support (`options` + `begin`/`savepoint`) onto that reserved session; builds `lockedDb = drizzle(reserved, { schema })`; acquires `pg_advisory_lock` on the same session; passes `lockedDb` to the callback.
3. `uploadFamilyMedia` lock-held path uses **only** `lockedDb` for replay lookup, authorization, insert TX, pipeline status updates, ready/audit TX, and recovery. Outer `db` is unused inside the lock (callers still pass the authority-bound Database for API stability).
4. Domain module does not read `DATABASE_URL`, create client/pool, or implicitly fetch a global db. Route binds `getSharedSqlClient()`; tests bind `getTestSqlClient()` or an isolated `max=2` pool for the saturation case.

### Session lifecycle

```text
reserve → attachDrizzleSessionSupport → drizzle(reserved) → pg_advisory_lock
  → run(lockedDb)  // may include scan/reencode/object I/O outside DB TX
  → finally pg_advisory_unlock
→ finally reserved.release()
```

Nested `finally` guarantees unlock + release on callback throw and on lock-path failure after acquire.

### Capacity boundary

- One upload holds at most **one** shared postgres.js session while locked.
- Different keys may queue when the pool is full, but must not deadlock by holding a reserved lock session while waiting for a second query connection.
- Saturation proof: isolated pool `max=2`; two different keys enter lock callbacks concurrently; each callback runs real SQL on `lockedDb` and waits on a barrier; both complete under a finite timeout.

### Failure cleanup

- Callback throw propagates after unlock + release.
- Same `(uploaderId, key)` can reacquire afterward (regression asserts finite-timeout reacquire).

### Invariant evidence matrix

| # | Invariant | Evidence |
|---|-----------|----------|
| 1 | Same key → one created + replay, one media, one uploaded audit | `family-media.test.ts` concurrent same-key/same-payload block |
| 2 | Different keys concurrent; pool saturation still advances | lock tests: different-keys + max=2 saturation |
| 3 | One reserved session carries lock + all DB work | lock adapter + `uploadFamilyMedia` lockedDb-only path |
| 4 | Scan/reencode/object I/O outside DB TX, may hold lock | unchanged pipeline structure; TX only around insert/finalize |
| 5 | Adapters bind injected SQL authority; no domain pool/URL | `createPostgresMediaUploadIdempotencyLock(sql)` + route/test wiring |
| 6 | acquire/unlock/release cleaned in nested finally | lock implementation + callback-error reacquire test |

### Verification command log (this stage)

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/family-content/media-upload-idempotency-lock.test.ts` | exit 0 — **4/4 passed** |
| `pnpm test -- tests/integration/family-content/family-media.test.ts` | exit 0 — **12/12 passed** |
| `git diff --check` | clean |

### Changed files (this stage)

- `src/modules/family-content/media-upload-idempotency-lock.ts`
- `src/modules/family-content/media-upload.service.ts`
- `tests/integration/family-content/media-upload-idempotency-lock.test.ts`
- `research/p2-architecture-rework-record.md` (append only)

### Not run (per connection-ownership directive)

- Migration tests / full test suite
- typecheck / lint / format / build
- E2E
- Milestone gate
- purge / migration / capability implementation or test changes

---

## Reserved session cleanup (micro rework)

- Directive: `research/p2-reserved-session-cleanup-directive.md`
- Execution baseline SHA: `4de91d2edea670de4f46e1b3125c08b7dea51571`
- Scope: ensure adapter/ORM initialize after `reserve()` cannot leak the reserved session. Does **not** change upload idempotency, connection authority, migration, purge, capability, or UI.

### Required control flow

```text
reserve
→ outer try/finally guard established immediately
→ adapter/ORM initialize (createLockedDb / attach + drizzle)
→ pg_advisory_lock
→ callback(lockedDb)
→ pg_advisory_unlock   // only if lock acquired
→ reserved.release()   // always in outer finally
```

### Exception-exit evidence (acquire → guard → initialize → use → cleanup)

| Exit point | Path | Cleanup | Evidence |
|------------|------|---------|----------|
| Initialize throws after reserve | factory seam throws before lock | outer `finally` → `release()`; no unlock | max=1 test: init boom → same pool re-reserves / queries / same-key lock within timeout |
| Lock acquisition throws | after successful initialize | outer `finally` → `release()`; unlock not entered | nested try: unlock only inside post-lock `finally` |
| Callback throws | lock held | inner `finally` unlock → outer `finally` release | existing callback-error reacquire test |
| Success | full path | unlock → release | same-key serial / different-key parallel / max=2 saturation |

### Test seam

- Optional `createLockedDb?: LockedDbFactory` on `createPostgresMediaUploadIdempotencyLock(sql, options?)`.
- Default remains `attachDrizzleSessionSupport` + `drizzle(reserved, { schema })` on the reserved session.
- No process-level hooks, no new client/pool in production path.

### Verification command log (this stage)

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/family-content/media-upload-idempotency-lock.test.ts` | exit 0 — **5/5 passed** |
| `git diff --check` | clean |

### Changed files (this stage)

- `src/modules/family-content/media-upload-idempotency-lock.ts`
- `tests/integration/family-content/media-upload-idempotency-lock.test.ts`
- `research/p2-architecture-rework-record.md` (append only)

### Not run (per reserved-session-cleanup directive)

- Migration tests / full test suite / family-media.test.ts
- typecheck / lint / format / build
- E2E
- Milestone gate
