# M6 P3：M5 并发验证阻断聚焦整改指令（NO-GO）

## 固定信息

- Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
- 分支：`feat/m6-lifecycle-redemption-acceptance`
- 被审 HEAD：`a59cd32b3df11d9b18ca4201a04cee0e480cb586`
- 执行基线：以包含本文件的 Codex 提交完整 SHA 为准
- 当前结论：**NO-GO**。只关闭本文件描述的 M5 并发验证阻断；不得启动全量 Vitest、全量 E2E、容量 1k/10k 或下一里程碑。

## 已复现症状

Codex 于 2026-09-02 只执行一次：

```bash
pnpm test -- tests/integration/training/m5-concurrency.test.ts --reporter=verbose
```

结果：`1 failed file`，`2 failed / 16 passed`，约 64.75 秒。两项失败均为：

```text
Timed out waiting for all submit backends waiting on competition advisory lock
```

失败用例：

1. `concurrent dual-session submit yields one effective and one practice with exact side effects`
2. `concurrent same-session submit with same idempotency key deduplicates side effects`

## 已确认根因边界

生产 `submitTrainingSession` 当前按冻结顺序获取：

1. `buildFullRebuildProjectionLockKey()` 全局事务级 advisory lock；
2. `buildSubmitCompetitionLockKey(...)` 每学生/训练/家庭日期事务级 advisory lock。

旧 `runConcurrentSubmitsWithContentionEvidence` 只 gate 第二把 competition lock，并要求两个 runner 同时在该锁上等待。由于第一把全局排他锁已先把两个 submit 事务串行化，第二个 runner 无法与第一个 runner 同时到达 competition lock；等待条件与当前生产锁顺序不相容。

该事实说明当前失败首先是**测试竞争证据过期**，不构成修改生产锁语义的授权。M5 已签署的生产不变量、全量 rebuild 与 submit 的锁顺序、effective/practice、幂等和精确副作用验收线不得削弱。

## 唯一整改范围

### R01：更新真实竞争证据

- 调整 `tests/helpers/training-submit-race.ts` 及必要的 `tests/integration/training/m5-concurrency.test.ts`，使竞争辅助器与生产的实际两级锁顺序一致。
- 必须仍使用真实 PostgreSQL advisory-lock 竞争证据；不得以 `Promise.all`、延时、mock、仅结果断言或放宽超时替代。
- 证据至少证明：两个 runner 已进入真实 submit 锁链；一方持有当前阻塞锁、另一方等待；释放 gate 后两者收敛。
- dual-session 用例仍须证明恰好一个 effective、一个 practice，且 metrics/projection/audit/outbox 精确计数不变。
- same-session 同幂等键用例仍须证明副作用去重且返回语义一致。

### R02：保持辅助器安全清理

- 保留既有正/负 hash lock 识别、观察失败、runner 提前失败、unlock/close 注入、cleanup aggregate 和无残留连接/锁测试。
- 所有失败路径必须先释放 gate 或终止其连接，再有界等待 runner，最后关闭 monitor/clients。
- 不得以 `forceExit`、扩大默认超时或删除清理断言掩盖问题。

### R03：记录验证事实

- 更新 `research/p3-implementation-record.md`：把旧“3 项失败/未复核”改为本轮实际结果和整改后的最终摘要。
- 不修改 P1/P2 签署、PRD、design、implement、task 状态或 Codex 签署结论。

## 禁止范围

- 不得修改 `src/modules/training/session.service.ts` 的生产锁顺序或业务语义，除非发现新的、可复现的生产缺陷；如发现必须停止并只回报，不得自行扩围。
- 不得修改 schema/migration、M6 兑换/导出/删除业务、UI、E2E、容量/恢复脚本、依赖或配置。
- 不得改动、删除、暂存或提交工作区现有的 `AGENTS.md`、P3 诊断文件和 M1 archive E2E 日志。
- 不得 pull/fetch、切分支、merge/rebase/reset、push、部署或启动下一阶段。

## 验证与提交

依次执行且每项最多一次：

```bash
pnpm test -- tests/integration/training/m5-concurrency.test.ts --reporter=verbose
pnpm typecheck
pnpm lint
pnpm format
git diff --check
```

要求：聚焦文件必须 `18 passed / 0 failed` 并正常退出；typecheck、lint、format、diff-check 均退出 0。若未达到，保留失败证据并停止，不得继续全量测试。

只做一次聚焦提交，提交仅包含本整改直接相关的测试辅助器、测试和 P3 实施记录。回报：

- branch、完整 HEAD、完整执行基线；
- 根因与修改机制；
- 修改文件；
- 原始验证摘要；
- 是否触及生产代码（预期：否）；
- 剩余 blocker/deferred；
- 结尾写“已交审核”。
