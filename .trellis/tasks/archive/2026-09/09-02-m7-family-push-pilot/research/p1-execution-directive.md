# M7 P1 唯一执行指令：文本/链接、预约、作答与评论闭环

## 固定交接

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 分支：`feat/m7-family-push-pilot`
- 执行基线：由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 范围：仅 P1；R-M7-01～04、R-M7-07～08，AC-M7-01～04、AC-M7-07～08。

开始前核对当前分支、HEAD、基线和工作区。允许保留既有未提交 `AGENTS.md`，不得暂存、覆盖、回退或提交它；若出现其他未知变更，立即停止报告。双方共享同一目录，不要 pull/fetch、切换分支或创建 worktree。

## 必读依据

1. `.trellis/tasks/09-02-m7-family-push-pilot/prd.md`
2. `.trellis/tasks/09-02-m7-family-push-pilot/design.md`
3. `.trellis/tasks/09-02-m7-family-push-pilot/implement.md`
4. `CONTEXT.md` 中家庭推送、预约推送、推送作答、家庭推送评论、无预览外链、离关联推送处置
5. `docs/user-flows.md` §6、`docs/product-scope.md`、`docs/architecture.md`
6. `.trellis/spec/backend/` 与 `.trellis/spec/frontend/` 的索引及本阶段相关质量规范

## P1 交付范围

### P1-R01 权威模型与迁移

- 新增 Family Content 模块与 push/version、answer/version、comment/version 权威 schema/migration。
- 用 PostgreSQL check/unique/FK 固定状态、当前版本、版本唯一、作者/目标、预约/发布时间和幂等不变量。
- 正文版本不可覆盖；审计/outbox 不保存推送、外链、作答或评论正文。
- 本阶段不建立媒体表、不接受图片字段或上传。

### P1-R02 推送状态机与所有权

- 当前关联家长可为指定关联学生创建文本/原始 URL 推送，立即发布或预约发布。
- 只有创建家长可编辑未发布内容、停用、删除或取消预约；其他当前关联家长只读。
- 状态转换、相同 key 重放、不同 payload 冲突、并发发布/取消必须确定且可测试。
- 外链仅校验并保存原始 URL，不抓取标题、图片或摘要。

### P1-R03 预约 Worker 与通用通知

- 预约发布接入现有 outbox/Worker 的租约、幂等、有限重试和 dead/replay。
- Worker 领取后实时复核 creator relationship、student freeze 与状态；同一 push 最多发布一次、产生一次通用站内通知。
- 发布、作答和评论通知不得含正文、URL、学生私密信息、积分或媒体地址；不得接入浏览器/短信/微信/邮件渠道。

### P1-R04 实时授权、冻结与离关联

- 每次列表、详情、写入都实时复核目标学生、active relationship、账户冻结与必要 authorization epoch；无权/不存在不泄露。
- 目标学生只能读取自己的推送并提交自己的作答；家长不得改写学生作答。
- 创建家长离关联时，同一事务取消其 scheduled 推送；已发布历史留给仍在家庭的成员，离关联家长立即失去访问和编辑权。
- 学生账户冻结后拒绝 Family Content 普通读写和预约发布。

### P1-R05 版本化文本作答与评论

- 学生对已发布且 active 的推送提交文本作答；每次补充新增版本，不能覆盖历史。
- 当前关联家长可评论，学生可回复；作者只能编辑/删除自己的评论。
- 普通读取只见当前版本；删除后只见删除标识。历史正文不得进入 audit/outbox/log/error。
- 停用、删除或冻结后拒绝新作答/评论。

### P1-R06 Route、DTO 与双视口 UI

- Route 薄层、写入要求 `Idempotency-Key`、错误映射遵守项目规范。
- 家长 UI：创建文本/原始链接、立即/预约、列表/详情、编辑未发布、停用/删除、评论。
- 学生 UI：列表/详情、版本化文本作答、回复与自有评论编辑/删除。
- desktop Chromium 与 360×800 覆盖主路径、所有权拒绝、冻结、离关联、终态冲突和预约失败反馈；无横向滚动，危险删除明确确认。

## 必须测试的矩阵

- migration：状态/check/unique/FK/版本/current pointer/幂等约束正反例。
- service：创建、编辑、立即/预约、取消、发布、停用、删除、作答版本、评论版本/删除。
- 并发：发布 vs 取消、重复 Worker、dead replay、相同/不同幂等 payload。
- 权限：目标学生、创建家长、另一当前家长、无关家长、离关联创建者、冻结学生。
- 隐私：audit/outbox/log/error payload 不含正文或 URL；无权与不存在响应不泄露。
- E2E：desktop/mobile 的完整文本/链接、预约发布、作答与评论闭环。

## 实施记录与验证

新增 `research/p1-implementation-record.md`，逐项映射 P1-R01～R06、PRD R/AC-ID、主要文件、事务/锁序、权限矩阵和原始命令摘要。

至少执行一次且不得重复盲跑：

```text
pnpm db:migrate
pnpm test -- <本阶段 migration/family-content/family-access/freeze/outbox/audit/notification/api 聚焦范围>
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm exec playwright test <P1 E2E 文件> --project=desktop-chromium --project=mobile-360
git diff --check
```

共享数据库测试必须串行。E2E 先做短健康检查；失败则不盲跑完整用例。未执行或无最终结果的命令必须如实记录。

## 禁止事项

- 不实现图片、媒体表、扫描/重编码、对象存储、90 天媒体清理；这些属于 P2。
- 不实现错题库、视频、外链预览、系统级推送、AI/语音、私密推送或家庭外分享。
- 不修改 PRD/design/implement/本指令、任务状态或签署；不升级依赖，不绑定供应商。
- 不处理或提交既有 `AGENTS.md` 变更；不 merge/rebase/reset/push/deploy。

## 交付与回报

只创建一个聚焦 P1 业务提交，包含实现、migration、测试、UI 与实施记录。回报：

1. 分支、完整 HEAD、完整执行基线 SHA。
2. 完成的 P1-R/PRD R/AC-ID。
3. 修改文件与关键行为。
4. 每条验证命令的精确结果。
5. `git status --short --branch` 和 blocker/deferred。
6. 结尾必须写“已交审核”；不得自行 GO、启动 P2 或修改验收线。
