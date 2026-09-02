# M7 P2 Implementation Record

## Fixed handover

- Branch: `feat/m7-family-push-pilot`
- Execution baseline SHA: `87b2b387dd629751257fa5c1b96af955e9cb410e`
- Scope: P2 only (controlled images + delete/restore); R-M7-05～06, AC-M7-05～06; evidence toward AC-M7-09
- P1 state machine / text-link semantics: unchanged

## Requirement mapping

| P2-R | PRD R / AC | Delivery |
|------|------------|----------|
| P2-R01 | R-M7-05/06 | `0029_m7_family_media.sql`, `media_objects` / `media_references` / `media_purge_intents` / `media_read_capabilities`, `PrivateMediaStore` |
| P2-R02 | R-M7-05, AC-M7-05 | magic/MIME/size, `MediaScanner` fail-closed, `sharp` re-encode, staging→promote |
| P2-R03 | R-M7-05, AC-M7-05 | ready media on push/answer versions; short-TTL capability + real-time re-auth read |
| P2-R04 | R-M7-06, AC-M7-06 | delete revoke refs/capabilities; zero-ref `purge_after=+90d`; outbox purge worker idempotent |
| P2-R05 | R-M7-06, AC-M7-06 | `purgeFamilyContentBodiesForStudent` in deletion PURGE_BODIES; tombstone replay + canary |
| P2-R06 | AC-M7-05/08 | multipart upload + capability/read routes; parent/student image UI; dual-viewport E2E |

## Schema / invariants

- `media_objects`: status staging|processing|ready|rejected|revoked|purged; ready requires clean scan + safe key + sha256 + ready_at; byte_size ≤ 10 MiB; `purge_after = unreferenced_at + 90 days`
- `media_references`: unique (resource_type, resource_id, media_id); unique active (resource_type, resource_id, purpose)
- `media_purge_intents`: unique media_id; pending|completed|dead
- `media_read_capabilities`: token_hash unique; binds media + reference + actor + student + authorization_epoch + TTL
- Push/answer version content checks relaxed for media-only bodies (app enforces text|link|media)

## Transaction / lock order

### Upload
1. Auth (parent linked / target student) + freeze
2. Insert `media_objects` staging (idempotent uploader+key)
3. `putStaging` → scan → re-encode → `promoteSafe`
4. Mark ready + audit (`media.uploaded` metadata only)

### Attach (create/edit push / submit answer)
1. Lock push / answer aggregate
2. Insert version row
3. Lock media `FOR UPDATE`; require ready + uploader match; insert reference; bump `reference_count`; cancel pending purge intent if re-referenced
4. Audit/outbox (opaque ids, lengths, counts — never body/keys/tokens)

### Delete push
1. Lock push → status deleted
2. Revoke all push (+ answer) media references in same TX
3. On refcount 0: set `unreferenced_at`/`purge_after`, upsert purge intent, outbox `family_media.purge_requested` with `availableAt=purge_after`
4. Immediate capability revoke for those references

### Purge worker
1. Lock media; no-op success if purged / still referenced / missing
2. If `purge_after > now` throw (retry until due)
3. Purge safe+staging keys; status=purged; complete intent; audit `media.purged`

### Account deletion / tombstone
1. Data Lifecycle `PURGE_BODIES` → Family Content `purgeFamilyContentBodiesForStudent` (cancel scheduled, clear bodies, revoke media, mark pushes deleted)
2. Tombstone replay re-runs same clear **before** projection rebuild
3. Canary: no readable bodies, no active refs, no live capabilities

## Media threat matrix

| Threat | Control |
|--------|---------|
| Wrong/declared MIME | magic bytes must match declared allowlist |
| Oversize | hard 10 MiB before staging |
| Truncated / decode bomb | sharp full decode + `limitInputPixels` + dimension caps |
| Malware / unscanned | injectable `MediaScanner`; production default fail-closed (`scanner_not_configured`) |
| Raw upload readable | staging never capability-readable; only promoted safe object |
| Path traversal | `assertSafeMediaKey` + root-relative resolve |
| Permanent URL / key leak | DTO returns media/reference ids only; capability short TTL; audit/outbox exclude keys/tokens/filenames/bytes |
| Stale capability | re-check epoch, freeze, relationship/resource, ref active, media ready on every read |
| Premature purge | Worker gates on `purge_after`, zero refs; re-reference cancels pending intent |

## Delete order

1. Ordinary read revoke (capabilities + refs) in same command TX as push delete / account purge
2. Zero-ref → schedule physical purge at +90 days
3. Worker physical purge after due; idempotent on replay
4. Account deletion clears M7 bodies then media; tombstone replay repeats clears before rebuild

## Key files

- Migration/schema: `src/db/migrations/0029_m7_family_media.sql`, `src/db/schema/family-content.ts`
- Store/scanner: `private-media-store.ts`, `media-scanner.ts`, `route-media-stores.ts`
- Pipeline: `media-validate.ts`, `media-reencode.ts`, `media-upload.service.ts`
- Refs/capability/purge: `media-reference.service.ts`, `media-capability.service.ts`, `media-purge.service.ts`
- Deletion: `account-deletion.service.ts` + hooks in `deletion-request.service.ts` / `tombstone-replay.service.ts`
- Routes: `/api/family/students/[studentId]/media`, `.../references/[referenceId]/capability`, `/api/media/read`
- UI: parent/student push pages + `MediaPreviewList`
- Tests: `tests/integration/family-content/family-media.test.ts`, `tests/e2e/m7-family-push-media.spec.ts`

## Dependency

- Added direct dependency **`sharp`** only — required for reliable decode/re-encode; no vendor SDKs.
- Lockfile: `pnpm-lock.yaml` updated accordingly.

## Deferred (production blockers — unchanged)

- Production object-store provider / bucket / keys / DPA / residency ADR
- Production malware scanner vendor (must not ship always-clean)
- Real production media drill / ops runbook
- Full AC-M7-09 suite (full test/typecheck/lint/format/build/complete dual-viewport) deferred to P2 sign-off / merge gate

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | exit 0 — Migrations complete (0029 applied) |
| `pnpm test -- tests/integration/family-content/family-media.test.ts` | exit 0 — **4/4 passed** |
| `pnpm test -- tests/integration/family-content/family-content.test.ts` | exit 0 — **11/11 passed** (P1 regression) |
| `pnpm build` | exit 0 — required to run `next start` E2E webServer |
| `pnpm exec playwright test tests/e2e/m7-family-push-media.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — **2/2 passed** |

Not run (deferred to sign-off/merge per directive): full test suite, typecheck, lint, format, full dual-viewport E2E beyond P2 media spec.
