# M7 P2 Implementation Record

## Fixed handover

- Branch: `feat/m7-family-push-pilot`
- Execution baseline SHA: `87b2b387dd629751257fa5c1b96af955e9cb410e`
- Reviewed implementation SHA: `61926b4d8d37e27b7a4c247db9e2a31abfc10541`
- Remediation baseline SHA: `1fe141cbac5b01b8d76c122c05124edb3758a417`
- Scope: P2 only (controlled images + delete/restore); R-M7-05～06, AC-M7-05～06; evidence toward AC-M7-09
- P1 state machine / text-link semantics: unchanged

## Requirement mapping

| P2-R | PRD R / AC | Delivery |
|------|------------|----------|
| P2-R01 | R-M7-05/06 | `0029_m7_family_media.sql` + `0030_m7_media_student_binding.sql`, `media_objects.student_id`, refs/intents/capabilities |
| P2-R02 | R-M7-05, AC-M7-05 | Recoverable upload state machine; Content-Length gate; magic/MIME/size; scanner; sharp re-encode; staging→promote→finalize TX |
| P2-R03 | R-M7-05, AC-M7-05 | ready media on push/answer; short-TTL capability; Identity epoch/role; full binding re-auth |
| P2-R04 | R-M7-06, AC-M7-06 | Ordinary revoke = refs/caps only; `revokeSafe` no physical delete; +90d prepare→purge→finalize |
| P2-R05 | R-M7-06, AC-M7-06 | Deletion revoke + purge intents/outbox; stable `family_content.purged` audit; canary proves no ready/refs/caps |
| P2-R06 | AC-M7-05/08 | multipart upload + capability/read; dual-viewport E2E with readable images + finally cleanup |

## Concentrated remediation mapping (P2-F01～F06)

| Finding | Fix |
|---------|-----|
| **P2-F01** | `media_objects.student_id` FK + index; upload keys/DTO/payload include student; attach locks and verifies ready/uploader/`media.student_id`/resource chain/purpose |
| **P2-F02** | Recoverable upload: staging/processing resume (never success replay); ready+audit in one short TX; promote-then-finalize compensable by idempotent retry; route `Content-Length` gate before `formData()` |
| **P2-F03** | Purge `prepare` (short TX) → external idempotent delete → `finalize` (short TX); intent `prepared`/`pending` retry; `revokeSafe` is no-op for bytes |
| **P2-F04** | Capability uses Identity `getParentOrStudentRole` / `getUserAuthorizationEpoch`; issue/read verify media/reference/student/actor/resource bindings |
| **P2-F05** | Deletion schedules purge intents/outbox; audit key `audit:family-content-purge:{studentId}` (no wall clock); canary asserts no ready/active refs/live caps + revoke/cleanup state; tombstone replay idempotent |
| **P2-F06** | Integration covers JPEG/PNG/WebP, malformed/truncated/scan/reencode/staging/promote, shared refs, 90d worker path, dead replay, revoke token, dual-parent/epoch; E2E asserts readable images + finally temp cleanup |

## Schema / invariants

- `media_objects`: **`student_id` NOT NULL FK**; status staging|processing|ready|rejected|revoked|purged; ready requires clean scan + safe key + sha256 + ready_at; byte_size ≤ 10 MiB; `purge_after = unreferenced_at + 90 days`
- `media_references`: unique (resource_type, resource_id, media_id); unique active (resource_type, resource_id, purpose)
- `media_purge_intents`: unique media_id; **pending|prepared|completed|dead**
- `media_read_capabilities`: token_hash unique; binds media + reference + actor + student + authorization_epoch + TTL

## Upload & purge state machines / compensation / TX boundaries

### Upload
1. Auth + freeze; **reject oversized `Content-Length` before multipart materialization**
2. Idempotency: ready → success replay; staging/processing → **resume pipeline**; rejected/revoked/purged → not success; payload mismatch → conflict
3. External: putStaging → scan → reencode → promoteSafe (not inside DB TX)
4. **Short TX finalize**: status=ready + metadata-only `media.uploaded` audit (same TX). Promote success + finalize failure leaves processing; identical key+payload retries re-promote (idempotent) and finalize

### Attach
1. Lock aggregate; insert version
2. Lock media `FOR UPDATE`; require ready, not revoked, uploader=actor, **`media.student_id` = resource student**, purpose matches resource type/chain
3. Insert reference; bump refcount; cancel pending/prepared purge; audit/outbox opaque ids only

### Ordinary revoke (push delete / ref revoke)
1. Revoke reference + capabilities in command TX
2. Zero-ref → set unreferenced_at / purge_after=+90d, upsert pending intent + outbox `availableAt=purge_after`
3. **No physical delete**; `revokeSafe` does not remove bytes

### Purge worker
1. **prepare** short TX: lock; due + zero-ref; revoke caps; intent=`prepared`; return keys
2. **Outside TX**: idempotent `purgeSafe` / `purgeStaging`; any failure → intent pending + error category + throw (retry)
3. **finalize** short TX: re-lock; mark purged; intent completed; `media.purged` audit. Finalize failure after physical delete → retryable pending; replay converges without restoring readability
4. Lease expiry / dead replay / duplicate worker: idempotent no-op when already purged

### Account deletion / tombstone
1. Clear bodies; revoke all student refs/caps; mark student media revoked; schedule purge intents/outbox **in same business TX**
2. Audit idempotency key stable (no `now`); outbox dedupe stable per media+purgeAfter
3. Canary: empty bodies, no active refs, no live caps, no ready media, remaining objects in revoked/rejected/purged with purge intent

## Media threat matrix

| Threat | Control |
|--------|---------|
| Wrong/declared MIME | magic bytes must match declared allowlist |
| Oversize | Content-Length gate before formData + hard 10 MiB |
| Truncated / decode bomb | sharp full decode + `limitInputPixels` + dimension caps |
| Malware / unscanned | injectable `MediaScanner`; production default fail-closed |
| Raw upload readable | staging never capability-readable; only promoted safe object |
| Cross-student reuse | authoritative `student_id` + attach lock checks |
| Path traversal | `assertSafeMediaKey` + root-relative resolve |
| Permanent URL / key leak | DTO ids only; capability TTL; audit/outbox exclude keys/tokens/filenames/bytes |
| Stale capability | re-check epoch (Identity), freeze, relationship/resource, ref active, media ready+bindings |
| Premature physical delete | revoke ≠ purge; Worker gates on purge_after + zero refs |
| TX/object store split-brain | prepare/physical/finalize; compensate finalize failures |

## Key files

- Migration/schema: `0029_m7_family_media.sql`, **`0030_m7_media_student_binding.sql`**, `src/db/schema/family-content.ts`
- Store/scanner: `private-media-store.ts` (`revokeSafe` no physical delete), `media-scanner.ts`, `route-media-stores.ts`
- Pipeline: `media-validate.ts`, `media-reencode.ts`, `media-upload.service.ts`
- Refs/capability/purge: `media-reference.service.ts`, `media-capability.service.ts`, `media-purge.service.ts`
- Identity boundary: `src/modules/identity/user-role.service.ts` (`getUserAuthorizationEpoch`)
- Deletion: `account-deletion.service.ts`
- Routes: media upload (Content-Length gate), capability, `/api/media/read`
- Tests: `tests/integration/family-content/family-media.test.ts`, `tests/e2e/m7-family-push-media.spec.ts`

## Dependency

- Direct dependency **`sharp`** only — no vendor SDKs. Lockfile unchanged in this remediation.

## Deferred (production blockers — unchanged)

- Production object-store provider / bucket / keys / DPA / residency ADR
- Production malware scanner vendor (must not ship always-clean)
- Real production media drill / ops runbook
- Full AC-M7-09 suite (full test/typecheck/lint/format/build/complete dual-viewport) deferred to P2 sign-off / merge gate

## Final concentrated remediation (P2-FF01～FF06)

- Final remediation baseline SHA: `ae36006d15ab9dc108114e9fad5478a6be42e44a`
- Reviewed NO-GO SHA: `dd7b350899b9039ab06d7e1f492b2f6a69ab85fe`
- Scope: close remaining F02～F06 only; no PRD/design/implement/task-status edits

| Finding | Code evidence | Test evidence |
|---------|---------------|---------------|
| **P2-FF01** | `media-purge.service.ts`: prepare sets `status=purging` + increments `purge_generation` / `owned_generation`; physical fail releases ownership to pending; finalize requires matching ownership; attach cancels **pending only** (`media-reference.service.ts`); `0031_m7_media_purge_fencing.sql` | `P2-F03/F06: prepare vs attach races` — attach-first keeps object; prepare-first blocks attach while purging |
| **P2-FF02** | `media-upload.service.ts`: staging/scanner-error/promote → `markRecoverableFailure` (staging/processing + `scanResult=error`); permanent malware/reencode → rejected; `setMediaUploadFinalizeFailureHookForTest` injects real finalize TX throw after promote | `P2-F02: recoverable staging/scanner/promote/finalize failures resume by same key` — no hand-seeded processing row; finalize inject proves no ready-without-audit then same-key converges |
| **P2-FF03** | `issueMediaReadCapability` resolves role via Identity `getParentOrStudentRole(actorId)`; `actorRole` param removed; capability route no longer passes session role | `P2-F04: capability bindings; Identity role; freeze; ...` — student/parent/stranger/freeze/cross-family matrix |
| **P2-FF04** | `setFamilyContentDeletionTxFailureHookForTest` in `account-deletion.service.ts`; formal `applyTombstonesBeforeProjectionRebuild` | `P2-F05`: injected deletion TX rollback restores secrets/refs/caps/ready media; real restore then tombstone clears again; audit/outbox stable; no secret/token/staging in payloads |
| **P2-FF05** | `0030_m7_media_student_binding.sql` replaces silent `DELETE` with `RAISE EXCEPTION` for unbackfillable rows | `tests/integration/migrations/m7-media-student-binding.test.ts` — SQL assertion; fail-closed preserves facts; legal backfill binds; 0031 fencing columns present |
| **P2-FF06** | N/A (test quality) | Barrier concurrent upload + independent-TX duplicate attach; pixel bomb; dead replay asserts purged/intent/audit=1 (no tautology); E2E saves capability pre-delete and asserts `/api/media/read` fails post-delete |

### Upload / purge machines after final remediation

- Transient infra failures remain recoverable under staging/processing with explicit `scanErrorCategory`; identical key+payload resumes; different payload conflicts.
- Purge ownership is durable after prepare (`purging` + generation). Attach cannot succeed while owned. Physical delete failure releases ownership; finalize failure after physical delete keeps ownership (no re-attach to deleted bytes).

## Verification command log (final remediation)

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | exit 0 — Migrations complete (**0030** fixed SQL already applied previously; **0031** applied) |
| `pnpm test -- tests/integration/family-content/family-media.test.ts` | exit 0 — **8/8 passed** |
| `pnpm test -- tests/integration/migrations/m7-media-student-binding.test.ts` | exit 0 — **4/4 passed** |
| `pnpm build` | exit 0 — **prerequisite only** for `next start` E2E webServer (not claimed as sign-off evidence) |
| `pnpm exec playwright test tests/e2e/m7-family-push-media.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — **2/2 passed** |
| `git diff --check` | clean |

Not run (per final remediation directive): full test suite, typecheck, lint, format, full dual-viewport E2E beyond P2 media spec.
