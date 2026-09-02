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

## 最终最小修正（相对被复验提交 `4b7c95e0487c6b942ed38285df3d75f9851bacd6`）

- 执行基线：见 Cursor Prompt 完整 SHA
- 指令：`research/p1-final-correction-directive.md`
- 范围：仅 C1～C5；未实现 P2

### C1 并发幂等顺序

- 文件：`audit-replay.ts`（自 `create-push.service.ts` 抽出）、`push-lifecycle.service.ts`、`comment.service.ts`
- 事务路径：先 `FOR UPDATE` 稳定资源行，再事务内 `findAuditReplay` / `assertAuditReplayMatch`，然后业务写入
- 证据：`family-content.test.ts` → `C1: concurrent same-key replay and different-payload conflict`

### C2 预约测试确定性

- `processTargetOutboxUntil(dedupeKey, predicate)`：推迟无关 pending、使目标到期并有上限条件等待；替换固定 `drainOutbox()` 盲跑
- 证据：`AC-M7-07` 期望 `published` 且保留通知/隐私断言

### C3 Worker 自动取消证据

- 冻结：删除请求冻结后推送仍为 `scheduled`，Worker 取消；断言单一 cancel audit/outbox、隐私、dead replay 不去重失败
- 关系失效：直接将 `relationships.status` 置 `ended`（不经 `endRelationship` 取消助手、不伪造 push 回 `scheduled`），Worker 以 `relationship_inactive` 取消并同样断言
- 证据：`P1-F02`

### C4 双视口 E2E

- 预约发布：`publishScheduledPushViaWorker` 到期驱动 outbox Worker，禁止点击 `push-publish`
- 终态冲突：UI 点击陈旧停用 → `push-detail-error` 具体文案 + 详情可恢复/刷新后「已停用」
- 证据：`m7-family-push-flow.spec.ts` desktop + mobile

### C5 新接口经 Family Content 公共 service

- `getFamilyPush` / `listFamilyPushes` / `createFamilyPush` / `loadUserRole` 覆盖 active/inactive、parent/student/admin/missing
- 证据：`P1-F03`

### 最终修正验证命令日志

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/family-content/family-content.test.ts` | exit 0 — 11/11 passed |
| `pnpm exec playwright test tests/e2e/m7-family-push-flow.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — 8/8 |
| `git diff --check` | exit 0 — clean |

## P1 测试证据最终修正（相对基线 `7f70716d29261e8d882da3094a62bc2ea6df0f4f`）

- 范围：仅测试、受控 outbox seam、本实施记录；未改业务契约、未实现 P2

### 1. 消除 outbox 测试全局队列污染

- Seam：`claimOutboxEventById` / `processOutboxEventById`（`process-outbox-event.service.ts`）按 eventId 领取/处理，不改变生产 `claimNextOutboxEvent` 排序语义
- 集成 helper：`processTargetOutboxUntil` 只更新并处理本测试追踪的 `dedupeKey` 目标行，不再把无关 pending 延后 24h
- E2E helper：`publishScheduledPushViaWorker` / `processTrackedOutboxByDedupeKey` 同上；desktop/mobile 轮次之间不遗留全局队列改写

### 2. 真正的并发不同 payload/action 证据

- `C1`：使用从未写入 audit 的全新 Idempotency-Key，同时启动同资源不同 payload/action（edit vs publish、comment edit vs delete）
- 锁序说明：先 `FOR UPDATE` 资源行再事务内 audit 复核 → 至多一次成功写入，另一请求 `IDEMPOTENCY_CONFLICT`，且不得泄漏 Postgres unique violation
- 另覆盖不同资源复用同一全新 key：结果为成功或 `IDEMPOTENCY_CONFLICT`，断言无 unique/23505 泄漏

### 3. 两类自动取消 dead replay 的通知断言

- `frozen` / `relationship_inactive`：replay 前记录 notification 数量；replay+处理后数量不变；cancel audit/outbox 仍各一条
- 保留正文不进入 audit/outbox/notification 的隐私断言

### 本轮验证命令日志

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/family-content/family-content.test.ts` | exit 0 — 11/11 passed (20.84s) |
| `pnpm exec playwright test tests/e2e/m7-family-push-flow.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — 8/8 passed (1.5m) |
| `git diff --check` | exit 0 — clean |

## P1 租约违规修正（相对基线 `197f59786c2e878bb0c51bd9a237ba73ccff9394`）

- 范围：outbox claim seam、目标事件 helper、聚焦测试、本实施记录；未改 Family Content 业务行为、未实现 P2

### 1. 目标 outbox helper 遵守租约

- 集成/E2E helper 仅可加速 **pending** 目标行的 `availableAt`
- 不得把 leased 强制改回 pending，不得清除有效 `leaseToken` / `leaseOwner` / `leasedUntil`
- 未到期 leased：有上限轮询；仍占用则明确失败
- 已过期 leased：经 `processOutboxEventById` 正式 claim 规则接管
- 不修改无关 outbox 行

### 2. claim 路径去重

- `takeOutboxClaimLease` 私有 helper 统一租约更新、attempt 记账与日志
- `claimNextOutboxEvent` / `claimOutboxEventById` 共用；生产 `processNextOutboxEvent` 语义不变
- by-id seam 仍检查 `availableAt`、pending 或已过期 leased

### 3. 聚焦租约三态测试

- 文件：`tests/integration/outbox/outbox-claim-by-id.test.ts`
- pending 可按 ID 领取处理；未到期 leased 不可抢占且 owner/token/attempt 不变；已过期 leased 可正式接管

### 本轮验证命令日志

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/outbox/outbox-claim-by-id.test.ts` | exit 0 — 3/3 passed (6.12s) |
| `pnpm test -- tests/integration/family-content/family-content.test.ts` | exit 0 — 11/11 passed |
| `pnpm exec playwright test tests/e2e/m7-family-push-flow.spec.ts --project=desktop-chromium --project=mobile-360` | exit 0 — 8/8 passed (1.4m) |
| `git diff --check` | exit 0 — clean |
