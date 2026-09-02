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

## 集中整改（相对被审核提交 `ecd4eaa5546ecd0c6518d8b125ae5083e972b7ca`）

- 整改基线：`b712c431cb3538bdceec33f7f12d76e360a1da31`
- 指令：`research/p1-remediation-directive.md`
- 范围：仅 P1-F01～F04；未实现 P2

### P1-F01 幂等 payload 冲突语义

- 文件：`push-lifecycle.service.ts`、`comment.service.ts`、`create-push.service.ts`（`findAuditReplay` / `assertAuditReplayMatch`）
- 行为：edit 与 transition 共用持久化 key `audit:family-push-command:{Idempotency-Key}`，以完整规范化命令 payload hash（含 command/action/资源/正文/URL/预约）校验重放；comment edit/delete 共用 `audit:push-comment-mutate:{key}` 并比较 payload hash。同 key 不同动作/正文返回 `IDEMPOTENCY_CONFLICT`；事务内竞态复核保留。
- 证据：`family-content.test.ts` → `P1-F01: edit/transition/comment mutate idempotency payload conflicts`

### P1-F02 Worker 状态转换 audit/outbox 原子性

- 文件：`m7-outbox-handlers.ts`、`constants.ts`（`CANCELLED`）、`worker-constants.ts`（noop）
- 事务/锁序：worker 锁定 `family_pushes` → 状态写入 → metadata-only audit（`audit:family-push-worker-publish|cancel:{pushId}`）→ 版本化 outbox（`family_push.published|cancelled`）；冻结与关系失效自动取消同事务完成。payload 仅 opaque ids/reason；dead replay 依赖 status 早退 + audit/outbox dedupe。
- 证据：`family-content.test.ts` → `P1-F02: scheduled publish and auto-cancel write audit/outbox atomically`

### P1-F03 模块边界与 NotificationDto 所有权

- `listActiveParentIdsForStudent` → `family-access/authorization.service.ts`
- `getParentOrStudentRole` / `lockUserRowForUpdate` → `identity/user-role.service.ts`；Family Content `access.ts` 不再直读 `relationships`/`users`
- `NotificationDto` → `notification/dto.ts`；notification 不再反向依赖 family-content
- 证据：`family-content.test.ts` → `P1-F03: family-access/identity interfaces own relationship and role reads`

### P1-F04 AC-M7-08 双视口验收矩阵

- 文件：`tests/e2e/m7-family-push-flow.spec.ts`（4 场景 × desktop-chromium + mobile-360）
- 覆盖：文本/链接、预约创建与发布可见、预约失败可恢复反馈、作答 v2、评论编辑/删除、非创建者写入拒绝、终态冲突、危险删除确认、冻结、离关联、无横向滚动

### 整改验证命令日志

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | exit 0 — Migrations complete |
| `pnpm test -- tests/integration/family-content/family-content.test.ts` | exit 0 — 10/10 passed |
| `pnpm test -- tests/integration/family-access tests/integration/identity tests/integration/outbox tests/integration/audit tests/integration/api` | exit 0 — 170/170 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — 0 errors (6 pre-existing warnings) |
| `pnpm format` | exit 0 — All matched files use Prettier |
| `pnpm build` | exit 0 — Compiled successfully |
| `pnpm exec playwright test tests/e2e/home.spec.ts --project=desktop-chromium` | exit 0 — health 2/2 |
| `pnpm exec playwright test tests/e2e/m7-family-push-flow.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — 8/8 |
| `git diff --check` | exit 0 — clean |
