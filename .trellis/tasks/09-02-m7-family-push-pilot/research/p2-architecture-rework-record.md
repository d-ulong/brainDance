# M7 P2 Architecture Rework Record

## Fixed object

- Active task: `.trellis/tasks/09-02-m7-family-push-pilot`
- Directive: `research/p2-architecture-rework-directive.md`
- Branch: `feat/m7-family-push-pilot`
- Execution baseline SHA: `3df50b370e4753dd432c804474c32b602ead660b`
- Reworked NO-GO commit (context only): `db0e9dbb96af4483a61ff8ff5017f635741c1f08`
- Scope: rebuild MediaPurge / MediaUpload test seams / MediaMigrationGate evidence only

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

### Failure matrix (tested)

| Case | Mid-state | After retry |
|------|-----------|-------------|
| throw-before-delete (`purgeSafe`) | purging + prepared + owned_generation; attach rejected | purged; audit=1; zero active refs |
| delete-before-throw (`purgeSafe`) | bytes may be gone; still purging/prepared; attach rejected | purged; audit=1 |
| safe ok / staging fail | safe gone; staging error category; ownership held | purged |
| physical ok / finalize fail (DB trigger) | objects gone; `finalize_failed`; ownership held | purged; audit=1 |

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
- `assertMediaMigrationCompatibility(client)` compares applied `drizzle.__drizzle_migrations.hash` (by journal `when`) to current SQL SHA-256 (same algorithm as drizzle-orm).
- On mismatch: `MediaMigrationCompatibilityError` with explicit “rebuild non-production development database” guidance.
- Does **not** drop/reset/TRUNCATE user databases; does **not** claim revised SQL re-executed.
- Wired into `scripts/migrate.ts` after `migrate()`.

### Upgrade / compatibility tests

| Test | Result |
|------|--------|
| Git evidence: 0029–0031 absent from main/tags | pass |
| Fresh install through 0031 | pass |
| `main` tip (`0027`) → branch final schema once | pass |
| Recorded old `0030` (dd7b350 DELETE SQL) → checksum mismatch; migrate skips revised SQL; gate fails closed | pass |

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

## AR-04 Non-vacuous evidence

- Pixel bomb: fixture creation failure fails the test; upload path runs and leaves `rejected` + `scanErrorCategory=reencode_failed`.
- Concurrent same-key upload: barrier + assertion of single ready row / single mediaId; rejected side (if any) has definite `FamilyContentError` codes.
- Concurrent different payload same key: exactly one success + one `IDEMPOTENCY_CONFLICT` + one ready row.
- Concurrent duplicate attach: independent transactions + barrier; one success, one definite unique/`FamilyContentError`; `referenceCount=1`; one active purpose ref.

## Changed files

- `src/modules/family-content/media-purge.service.ts`
- `src/modules/family-content/media-upload.service.ts`
- `src/modules/family-content/account-deletion.service.ts`
- `src/db/media-migration-gate.ts` (new)
- `scripts/migrate.ts`
- `tests/integration/family-content/family-media.test.ts`
- `tests/integration/migrations/m7-media-student-binding.test.ts`
- `research/p2-architecture-rework-record.md` (this file)

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/family-content/family-media.test.ts` | exit 0 — **8/8 passed** |
| `pnpm test -- tests/integration/migrations/m7-media-student-binding.test.ts` | exit 0 — **7/7 passed** |
| `pnpm build` | exit 0 — **E2E prerequisite only** (not claimed as sign-off evidence) |
| `pnpm exec playwright test tests/e2e/m7-family-push-media.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — **2/2 passed** |
| `git diff --check` | clean |

### Not run (per directive)

- Full test suite
- typecheck
- lint
- format
- Full dual-viewport E2E beyond P2 media spec
- Automatic drop/reset of user databases
- Migration renumber/merge/delete
