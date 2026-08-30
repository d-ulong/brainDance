# M5 P1 第五轮集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定审核 SHA / 整改基线：`a309b4c021d7995f992ecb7bee8fc28ae687dff2`
>
> 第四轮指令提交：`6d45ad8682e8f1ebbe4a5e18d736fd88e4c0c11f`
>
> 结论：**NO-GO；必须一次性关闭 P1-R23～P1-R25，禁止启动 P2。**

## 1. 审核结论

R18、R20、R21 已关闭；R19 的正常解锁、观察超时和 runner 提前失败已覆盖，但数据库解锁本身失败时仍不安全。R22 因此需再次校正。

Codex 独立串行质量门全部退出 0：migration；training unit 4/41；migration tests 6/35；training integration 4/29；outbox/audit 3/23；typecheck、format；lint 0 error / 3 个既有 warning。绿测未覆盖强制 unlock 失败。

## 2. 必读与允许范围

完整读取本文件、`research/p1-fourth-remediation-directive.md`、P1 implementation record 和 backend quality/error-handling 规范。

只允许修改关闭 R23～R25 必需的 `tests/helpers/training-submit-race.ts`、对应并发测试和 P1 implementation record。不得修改生产业务代码、schema、migration、任务规格或状态。

## 3. 全部整改项

### P1-R23 解锁失败时必须先关闭 gate，再只等待 runners 一次（高）

**依据**：第四轮 R19 要求所有退出路径先幂等释放锁或关闭 gate connection，再有界等待/cancel runners，最后关闭其余连接。

**现状**：`releaseGateLock` 在 `pg_advisory_unlock` 成功前先写入 `released=true`、`holding=false`，且吞掉错误。若 unlock 失败但 gate 连接仍存活，catch 会在 gate 仍持锁时等待 runners；finally 因假状态不再重试，并再次等待一个完整 settle 周期，之后才 `gate.end()`。

**修订**：

- 用单一、无非法组合的 gate 状态表达持锁/已释放/已关闭；不得用两个可矛盾 boolean。
- 只有确认 `pg_advisory_unlock` 返回成功后才能标记 released；若返回 false 或抛错，立即关闭/终止 gate connection以释放 session lock，且必须在等待 runners 之前完成。
- 合并 catch/finally cleanup，确保 runners 在任何失败路径只被有界等待一次；随后关闭 monitor 和 runner clients。不得吞掉关键清理失败而伪装成功，主错误与清理错误的优先级要确定且可诊断。
- 增加强制 unlock 抛错或返回 false 的测试，证明 helper 在明确短上限内 reject、没有残留目标 advisory lock、没有第二个 settle 周期。测试注入只能存在于 test helper，不得触及生产 service。

### P1-R24 测试 monitor 连接必须在断言失败时也关闭（低）

**依据**：工程错误处理与测试隔离要求。

**现状**：`m5-concurrency.test.ts` 两个 R19 测试仅在所有断言成功后调用 `monitor.end()`；中途 reject 文案、时间或锁数量断言失败会泄漏连接并干扰后续数据库测试。

**修订**：两处 monitor 生命周期使用 `try/finally`；新增的 unlock-failure 测试同样如此。不得用全局 afterAll 掩盖单测资源所有权。

### P1-R25 修正实施记录（中）

更新 implementation record：R18/R20/R21 可保持关闭；R19 只有在 R23/R24 证据通过后才标为完整闭环；记录第五轮指令/基线、R23～R25 测试定位和全部命令摘要。不得预写未知最终 HEAD。

## 4. 验证命令

在无其他测试进程时串行执行：

```bash
pnpm db:migrate
pnpm test tests/unit/training
pnpm test tests/integration/migrations
pnpm test tests/integration/training
pnpm test tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
git diff --check a309b4c021d7995f992ecb7bee8fc28ae687dff2..HEAD
```

## 5. 禁止项与完成定义

- 禁止启动 P2/P3/M6；禁止修改生产业务代码、schema 或 migration。
- 禁止修改本指令、PRD/design/implement/task status；禁止 merge/rebase/reset/push/deploy/归档。
- 禁止依赖升级和无关重构。
- 只提交一个聚焦整改 commit，建议：`test(m5-p1): make race cleanup failure-safe`。
- R23～R25 全部关闭、质量门如实记录、工作区干净后，仅声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: a309b4c021d7995f992ecb7bee8fc28ae687dff2
status: M5 P1 第五轮整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R23 ...
- P1-R24 ...
- P1-R25 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 第五轮整改已交 Codex 审核，未启动 P2。”**
