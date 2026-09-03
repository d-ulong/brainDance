# M7 P1 最终最小修正指令

## 固定交接

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 分支：`feat/m7-family-push-pilot`
- 被复验提交：`4b7c95e0487c6b942ed38285df3d75f9851bacd6`
- 执行基线：由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 本轮只修复下列已定位问题，不重新设计 P1，不扩大到 P2。

开始前核对分支、HEAD、基线和工作区；不得修改、暂存或提交 `AGENTS.md`。双方共享目录，不要 pull/fetch、切分支或创建 worktree。

## C1 并发幂等顺序

- `editFamilyPush`、`transitionFamilyPush`、`mutatePushComment` 的事务路径必须遵循：先锁定稳定资源行，再做事务内幂等重放复核，然后执行业务写入。
- 两个并发相同 key + 相同 payload 必须得到一次写入和一次成功重放；相同 key + 不同 payload/动作必须确定返回 `IDEMPOTENCY_CONFLICT`，不得泄漏唯一约束或随机状态冲突。
- 添加真实 PostgreSQL 并发聚焦测试。将共享幂等 helper 移出 `create-push.service.ts` 到专用模块，并删除无调用的旧 helper，避免反向职责扩散。

## C2 修复核心预约测试回归

- 当前独立命令 `pnpm test -- tests/integration/family-content/family-content.test.ts` 的结果为 10 项中 1 项失败：`AC-M7-07` 第 231 行期望 `published`，实际为 `scheduled`。
- 查明并修复确定性原因；不得靠增加固定 `drainOutbox()` 次数或重复盲跑掩盖队列顺序。测试应只等待/处理目标事件或使用有上限的明确条件，并保留通知与隐私断言。

## C3 补齐 Worker 自动取消证据

- 冻结与 relationship inactive 两种 scheduled 自动取消均须断言：单一 audit、单一 cancelled outbox、payload 无正文/URL、重复领取或 dead replay 不产生重复记录/通知。
- 不得通过先走正常离关联取消、再直接把数据库状态改回 `scheduled` 来伪造 Worker 场景；使用能隔离 Worker 实时复核的合法测试装置或事务安排。

## C4 修正双视口 E2E 语义

- “预约发布成功可见”必须真实经过到期 outbox/Worker 发布，不得点击 `push-publish` 手动发布替代。
- 终态冲突必须从 UI 触发并断言具体、可理解的错误反馈以及页面仍处于可恢复状态；不得只接受 API 404/409 和任意非空正文。
- desktop Chromium 与 mobile 360×800 继续复用同一场景矩阵。

## C5 新接口行为测试

- 不只直接调用 `listActiveParentIdsForStudent` / `getParentOrStudentRole`；增加通过 Family Content 公共 service 的聚焦行为测试，覆盖 active/inactive relationship，以及 parent/student/admin/missing role 的授权或不泄露结果。

## 验证与交付

- 只运行本轮新增/受影响核心代码的聚焦测试：Family Content 集成测试文件；若 E2E 装置可稳定驱动目标 Worker，则只运行 M7 P1 E2E 文件的 desktop/mobile。不要运行全量 test、全量 E2E 或无关检查。
- 运行 `git diff --check`；更新实施记录中的最终修正证据。未执行项如实记录。
- 只创建一个聚焦业务修正提交，不修改本指令、PRD/design/implement、任务状态或签署，不 merge/rebase/reset/push/deploy。
- 回报完整 HEAD、C1～C5 证据、精确命令结果、工作区状态，以“已交最终确认”结尾。
