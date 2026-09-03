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
