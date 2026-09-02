# M7 P1 集中整改唯一指令

## 固定交接

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 分支：`feat/m7-family-push-pilot`
- 被审核提交：`ecd4eaa5546ecd0c6518d8b125ae5083e972b7ca`
- 整改基线：由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 审核结论：NO-GO；本文件一次性列出 P1 全部阻断项。本轮为集中整改轮，验收线不变。

开始前核对分支、HEAD、整改基线和工作区。允许保留既有未提交 `AGENTS.md`，不得暂存、覆盖、回退或提交它；若出现其他未知变更，立即停止报告。双方共享同一目录，不要 pull/fetch、切换分支或创建 worktree。

## 必须整改

### P1-F01 幂等 payload 冲突语义

- `push-lifecycle.service.ts` 的编辑与状态转换、`comment.service.ts` 的编辑/删除必须以完整规范化命令 payload 校验幂等重放。
- 同一 `Idempotency-Key` + 相同命令/payload 返回原结果；同一 key + 不同正文、URL、预约时间、资源、动作或 edit/delete 形态必须返回项目既有幂等冲突，不得静默返回当前 DTO。
- 不得通过把 action 拼入持久化 key 来规避“同一客户端 key、不同动作冲突”。保留事务内竞态复核。
- 添加真实 PostgreSQL 聚焦测试，至少覆盖 push 编辑、publish/delete 等跨动作、评论 edit/delete 的相同 payload 重放与不同 payload 冲突。

### P1-F02 Worker 状态转换的审计与事件原子性

- `m7-outbox-handlers.ts` 中 scheduled → published，以及因冻结或关系失效导致 scheduled → cancelled，业务写入、metadata-only audit、版本化 outbox/领域事件必须在同一事务完成。
- audit/outbox/notification 不得包含推送正文、URL、作答或评论正文；重复 Worker、dead replay 不得重复发布、审计、事件或通知。
- 集成测试必须定位并断言预约发布与两类自动取消的 audit/outbox 记录、去重行为和无正文隐私要求。

### P1-F03 恢复模块边界与契约所有权

- Family Content 不得直接读取 Family Access 的 `relationships` 权威表或 Identity 的 `users` 权威表。把 active-parent 枚举与角色查询分别收口到所属模块的明确 service/interface，再由 Family Content 调用。
- `NotificationDto` 不应由 notification 模块反向依赖 family-content；将 DTO 所有权移入 notification 或中立契约位置，并保持 route/UI 类型一致。
- 不做无关重构；为新接口增加聚焦授权/行为测试。

### P1-F04 补齐 AC-M7-08 双视口验收矩阵

- `tests/e2e/m7-family-push-flow.spec.ts` 当前仅覆盖立即发布、单次作答、评论/回复与停用，不能作为完整 P1 验收。
- desktop Chromium 与 mobile 360×800 都必须可定位覆盖：文本和原始链接、预约发布及成功可见、非创建家长写入拒绝、冻结、离关联、终态冲突、预约失败反馈、第二版作答、评论编辑/删除、危险删除确认、无横向滚动。
- 可在同一 P1 E2E 文件内拆成少量独立场景并复用 bootstrap；不得仅用 service 测试替代 UI/API 验收。失败路径需断言用户可理解的反馈与可恢复状态。

## 验证与实施记录

- 更新 `research/p1-implementation-record.md`，新增“集中整改”小节，逐项映射 P1-F01～F04、文件、事务/锁序、测试证据与精确命令结果；不得改写本指令、PRD/design/implement 或任务状态。
- 至少执行：migration/family-content/family-access/identity/outbox/audit/notification/API 聚焦测试、`pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm build`、P1 E2E 的 desktop/mobile、`git diff --check`。
- 共享数据库测试串行；全量 test/E2E 每项最多一次。E2E 先做健康检查，失败则记录 blocker，不盲跑。
- 本轮只能创建一个聚焦整改提交；不得实现 P2 图片/媒体，不得 merge/rebase/reset/push/deploy，不得处理 `AGENTS.md`。

## 回报格式

1. 分支、完整 HEAD、完整整改基线 SHA、被审核提交 SHA。
2. P1-F01～F04 的逐项完成证据。
3. 修改文件与关键行为。
4. 每条验证命令的精确结果。
5. `git status --short --branch`、blocker/deferred。
6. 结尾写“已交最终复验”；不得自行 GO 或启动 P2。
