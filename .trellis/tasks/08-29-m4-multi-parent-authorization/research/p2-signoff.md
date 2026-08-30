# M4 P2 签署记录

> 状态：**GO**
>
> 已签署实现 SHA：`5ee0215e87ce4e634b93d64dbf0f3c7d1a694c1e`
>
> 签署基线 SHA：`ee81d36d340aae44b58372de4a2aecc038a49fc9`

## 已覆盖

- AC-M4-4：普通/私密每日总结、逐家长 grant/revoke、关系结束撤权、重新关联不恢复历史私密读取，以及 Route 无正文泄露。
- AC-M4-5：grant/revoke/end 的 idempotency、audit/outbox、用户 epoch 与 grant/end 确定性并发不变量。
- AC-M4-6：Route 2xx/4xx/403、DTO 脱敏、360px 主路径、数据库约束、静态检查及 E2E。
- P2-F01 至 P2-F04：锁顺序、生产 DTO 边界、确定性 grant/end 与 read/revoke 回归证据全部关闭。

## 质量证据

- Cursor 串行隔离质量门：`pnpm db:migrate`、`pnpm test`（50 files / 367 tests）、`pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm build`、`pnpm test:e2e`（14 passed）均通过；lint 为 0 errors、3 个既有 warnings。
- Codex 固定 SHA 独立复验：`pnpm vitest run tests/integration/reflection-privacy/reflection-privacy.test.ts -t "P2-F01|P2-F02"`（2 passed）与 `pnpm typecheck` 均通过。

## 未覆盖范围

- M5 训练、M6 生命周期/兑换、媒体/评论、通知渠道、管理员紧急访问及自定义权限分级均不在 M4 范围内。

P2 已准许进入 M4 归并阶段；归并本身仍须遵循单独的 `m4-merge-directive.md`。
