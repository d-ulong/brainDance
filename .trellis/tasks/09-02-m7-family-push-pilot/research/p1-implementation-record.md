# M7 P1 Implementation Record

## Fixed handover

- Branch: `feat/m7-family-push-pilot`
- Baseline SHA: `ff0ab6dd211a76acbc3e862447d0a9a5112ce859`
- Scope: P1 only (text/link, schedule, answers, comments, in-app notifications)

## Requirement mapping

| P1-R | PRD R / AC | Delivery |
|------|------------|----------|
| P1-R01 | R-M7-01, AC-M7-01 | `0028_m7_family_content.sql`, `src/db/schema/family-content.ts`, `notifications.ts` |
| P1-R02 | R-M7-01, AC-M7-01 | `create-push.service.ts`, `push-lifecycle.service.ts` ownership + state machine |
| P1-R03 | R-M7-07, AC-M7-07 | `m7-outbox-handlers.ts`, `notification.service.ts`, outbox `availableAt` |
| P1-R04 | R-M7-02, AC-M7-02 | `access.ts`, freeze guard, `cancelScheduledPushesOnRelationshipEnd` in relationship end |
| P1-R05 | R-M7-03/04, AC-M7-03/04 | `answer.service.ts`, `comment.service.ts` versioned bodies |
| P1-R06 | R-M7-08, AC-M7-08 | Thin routes, parent/student UI, `m7-family-push-flow.spec.ts` |

## Key files

- Schema/migration: `src/db/migrations/0028_m7_family_content.sql`, `src/db/schema/family-content.ts`, `src/db/schema/notifications.ts`
- Services: `src/modules/family-content/*`, `src/modules/notification/notification.service.ts`
- Outbox: `append-outbox-event.ts` (`availableAt`), `process-outbox-event.service.ts` (M7 handlers)
- Relationship end: `end-relationship.service.ts` cancels scheduled pushes in the same transaction
- Routes: `/api/family/students/[studentId]/pushes/**`, `/api/student/pushes`, `/api/notifications/**`
- UI: `src/app/parent/students/[studentId]/pushes/**`, `src/app/student/pushes/**`
- Tests: `tests/integration/family-content/family-content.test.ts`, `tests/e2e/m7-family-push-flow.spec.ts`

## Transaction / lock order

1. Lock `family_pushes` / `push_answers` / `push_comments` row (`FOR UPDATE`)
2. Recheck freeze + active relationship / ownership
3. Write authority + version row
4. Append audit (metadata only: ids, lengths, status; never body/URL)
5. Append outbox (opaque ids only)

Scheduled publish: `family_push.publish_requested` with `available_at = scheduled_publish_at` → worker locks push → publish once → `family_push.published` → notification fan-out with dedupe keys.

## Authorization matrix

| Actor | Create | Edit unpublished | Publish/cancel/disable/delete | Read published | Answer | Comment |
|-------|--------|------------------|-------------------------------|----------------|--------|---------|
| Creator parent (active) | yes | yes | yes | yes | no | yes |
| Other linked parent | no | no | no | yes | no | yes |
| Target student | no | no | no | published/disabled | yes (published) | yes (published) |
| Unrelated / unlinked creator | no | no | no | forbidden | no | no |
| Frozen student scope | blocked | blocked | blocked | blocked | blocked | blocked |

## Privacy

- Audit/outbox/notification payloads exclude body and URL; store opaque ids, lengths, status, actor/resource ids.
- Unauthorized and missing resources use non-leaking `FORBIDDEN` / `NOT_FOUND`.
- Deleted comments expose only deletion marker on ordinary reads.

## Deferred (P2)

- Images, media tables, upload/scan/re-encode, object storage, 90-day purge
- Account deletion/tombstone coverage for M7 bodies (P2 AC-M7-06)
- Full AC-M7-09 suite beyond P1 focused commands

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | exit 0 — Migrations complete |
| `pnpm test -- tests/integration/family-content/family-content.test.ts` | exit 0 — 7/7 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — 0 errors (6 pre-existing warnings) |
| `pnpm format` | exit 0 — All matched files use Prettier |
| `pnpm build` | exit 0 — Compiled successfully |
| `pnpm exec playwright test tests/e2e/home.spec.ts --project=desktop-chromium` | exit 0 — health 2/2 |
| `pnpm exec playwright test tests/e2e/m7-family-push-flow.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — 2/2 |
| `git diff --check` | exit 0 — clean |
