# M6 P1 最终验收修正 Cursor 执行指令

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> 最终复验对象：`ef357c1c5703c834d6c935e17cdc3029fa68d945`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 状态：**P1 NO-GO；验收线审计后只授权本文件 C01～C02，不授权 P2/P3、归并、推送或部署。**

## 1. 开始前核验

Codex 与 Cursor 使用同一目录，不 pull/fetch，不切换分支或创建 worktree。确认当前分支正确、工作区干净，且 HEAD 包含上述完整 SHA；不一致立即停止，不得 reset、rebase、stash、checkout 或清理文件。

## 2. 唯一修正范围

### C01（P1-F01）：并发 create 幂等重放仍可能 500

- `src/modules/redemption/catalog.service.ts` 在事务内捕获 PostgreSQL `23505` 后继续用同一 `tx` 查询；该事务已进入 aborted 状态，后续查询可能收到 `25P02`。
- 改为不会继续使用失败事务的实现，例如 `onConflictDoNothing` 后在有效事务中查询，或让冲突事务完整回滚后再读取；必须继续保证目录事实、audit、outbox 原子提交且只产生一套记录。
- 增加两个独立数据库连接发起的同 student、同 idempotency key、同 payload 并发 create 测试；断言两请求均按契约收敛、无 500、返回同一资源，且事实/audit/outbox 各只有一套。

### C02（P1-F06）：补齐既有强制验收证据

- 将当前顺序执行的月限次测试改为真实竞争：使用独立数据库连接并发发起会争用同一月限额的操作，断言限额、不重复扣减和终态在超时内收敛。
- 补齐上一指令已冻结、但当前仍缺的 Route 测试单元格。覆盖 catalog `create/update/list` 与 redemption `create/cancel/approve/reject`：
  - 每条 Route 均验证缺少身份 header；
  - 每条带路径 `studentId` 的 Route 均验证跨学生访问；
  - 每条需要有效家庭关系的 Route 均验证关系已解除；
  - 带资源 ID 的 update/cancel/approve/reject 均验证 unknown ID；
  - 接收 body 的 create/update/cancel/approve/reject 均验证非法 DTO；
  - 角色成功/拒绝矩阵继续覆盖 student、创建家长和其他有效家长，已有等价测试可直接在实施记录中引用，不重复造测试。
- 在 `p1-implementation-record.md` 中逐项列出新增或复用的测试名称；不得用测试文件名或“全绿”替代单元格映射。

## 3. 明确不在本轮处理

P1-F02～P1-F05 已闭合，不得重写；callback/helper 可读性、迁移观感及其他非阻断改进不进入本轮。不得新增依赖、修改 P2/P3、UI、导出、删除/tombstone 或做无关重构。

## 4. 验证与提交

无其他 runner 时串行执行：

```bash
pnpm db:migrate
pnpm test tests/integration/redemption/redemption-lifecycle.test.ts tests/integration/api/m6-routes.test.ts tests/integration/migrations/m6-schema-constraints.test.ts tests/integration/family-access/multi-parent-authorization.test.ts tests/integration/settlement/settlement-ledger.test.ts tests/integration/outbox/outbox-transaction.test.ts tests/integration/audit/audit-coverage.test.ts
pnpm typecheck
pnpm lint
pnpm format
```

共享数据库测试不得并行运行。只提交一个聚焦修正 commit，回报 `branch`、完整 `HEAD`、`correction_base`、C01/C02 修改文件、测试名称映射、原始验证摘要和 blocker。最后一句必须是：

**“M6 P1 最终验收修正已交 Codex 复验，未启动 P2，未归并、未推送、未部署。”**
