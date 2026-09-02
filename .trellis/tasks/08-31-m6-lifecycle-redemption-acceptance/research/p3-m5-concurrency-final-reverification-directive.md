# M6 P3：M5 并发验证最终复验整改指令（NO-GO）

## 固定信息

- Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
- 分支：`feat/m6-lifecycle-redemption-acceptance`
- 原整改基线：`0a07ed715f497678815b8e958bd3c31dc28d1fce`
- 被审提交：`5bf14b7c38bf292d6f59dd5de8cb55e46bf74287`
- 执行基线：以包含本文件的 Codex 提交完整 SHA 为准
- 结论：**NO-GO**。R01 两级锁主路径已闭合，不得重开；仅处理 C01～C02。

## Codex 独立复验事实

固定提交 `5bf14b7c38bf292d6f59dd5de8cb55e46bf74287` 上独立执行一次：

```bash
pnpm test -- tests/integration/training/m5-concurrency.test.ts --reporter=verbose
```

结果：`1 failed / 17 passed`，约 36.28 秒。失败：

```text
P1-R32: runner client close failure is recorded in cleanup aggregate
Expected: injected runner client close failure
Received: Concurrent submit race failed with cleanup error
```

实施记录同时明确写明 `pnpm format → exit 1`，定向 `prettier --write` 后未重新执行 `pnpm format`，因此格式门禁没有 exit 0 证据。

## C01：消除 cleanup 注入用例的非确定性结果

- 诊断为什么 `runner_client_close_throw` 场景有时只有单一 cleanup error，有时同时出现 primary race error，进而由 `combinePrimaryAndCleanupErrors` 返回聚合错误。
- 修复测试辅助器、测试编排或断言，使该场景在真实 PostgreSQL 两级锁竞争下确定性验证：注入的 runner client close failure 必须被保留，所有实际出现的 primary/cleanup error 必须被正确分类和断言，不能因调度差异偶发失败。
- 不得简单把断言放宽为任意 `AggregateError`、任意错误消息或 `toThrow`；必须证明注入错误存在，并在存在额外错误时验证其来源和语义。
- 保留 `18 passed / 0 failed`、真实 advisory-lock 证据、有界退出、最终无残留 advisory lock/数据库连接，以及既有全部 failure-injection 覆盖。
- 不得通过扩大超时、重试失败用例、随机 sleep、`forceExit`、跳过用例或删除 cleanup 断言规避。
- 不得修改 `src/` 生产代码；若发现生产缺陷，停止并只回报。

## C02：闭合格式门禁与记录

- 修改完成后执行全量 `pnpm format` 检查，必须 exit 0。
- 更新 `research/p3-implementation-record.md`，追加 Codex `17/18` 复验失败、C01 修复机制和最终命令摘要；不得抹去此前失败历史。
- 不修改 PRD、design、implement、task 状态或任何签署文件。

## 工作区与禁止范围

- 不得改动、删除、暂存或提交现有 `AGENTS.md`、`p3-verification-blocker-diagnosis.md` 和四份 M1 archive E2E 日志。
- 不得修改 M6 业务、schema/migration、UI、E2E、容量/恢复脚本、依赖或配置。
- 不得 pull/fetch、切分支、merge/rebase/reset、push、部署或启动全量测试/下一阶段。

## 验证、提交和回报

依次执行且每项最多一次：

```bash
pnpm test -- tests/integration/training/m5-concurrency.test.ts --reporter=verbose
pnpm typecheck
pnpm lint
pnpm format
git diff --check
```

全部必须 exit 0，聚焦测试必须 `18 passed / 0 failed`。失败即停止，不得继续全量测试。

只做一次聚焦整改提交，仅包含直接相关的测试辅助器、测试和 P3 实施记录。回报 branch、完整 HEAD、完整执行基线、C01 根因/修复、修改文件、原始验证摘要、是否触及生产代码、剩余 blocker/deferred，结尾写“已交审核”。
