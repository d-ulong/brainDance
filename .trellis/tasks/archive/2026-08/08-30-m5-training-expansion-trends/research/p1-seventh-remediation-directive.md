# M5 P1 第七轮集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定审核 SHA / 整改基线：`b8c33bb5f3c4e7c3fb4fef69aa348ab9010641f6`
>
> 第六轮指令提交：`0824195ab6707712bb492e7c52293964da206c70`
>
> 结论：**NO-GO；必须一次性关闭 P1-R31～P1-R34，禁止启动 P2。**

## 1. 审核结论

R26、R28 已关闭；R29 部分关闭。R27 测试虽然全绿，但它在 finally 真实 unlock 成功后才命中 close 注入，因此只证明“已无锁时报告 close error”，没有证明 close failure 后最终关闭真实 gate connection。

Codex 聚焦复跑 `m5-concurrency.test.ts`：1 file / 14 tests 通过；完整质量门此前亦无功能失败。绿测不能替代未命中的清理路径。

## 2. 必读与允许范围

完整读取本文件、`research/p1-sixth-remediation-directive.md`、P1 implementation record 和 backend error-handling/code-reuse 规范。

只允许修改 `tests/helpers/training-submit-race.ts`、对应并发测试和 P1 implementation record。不得修改生产代码、schema、migration、任务规格或状态。

## 3. 全部整改项

### P1-R31 close failure 后必须执行非注入的最终关闭（高）

**现状**：R27 场景在 post-observation unlock 注入失败后，finally 的 `releaseGateLockOrClose` 会再次真实 unlock 并成功；之后 close 注入才抛错。第二次 close 仍使用同一个 always-fail 注入，最终没有非注入 `gate.end()`。测试只断言 advisory lock 为 0，无法发现真实 gate connection 泄漏。

**修订**：

- close failure 注入必须只作用于明确的一次关闭尝试；记录诊断错误后，仍执行不带注入的最终 best-effort `gate.end()`。
- gate 只有在最终真实 termination 成功后才能标为 closed；若最终 termination 也失败，必须保留诊断状态并传播错误。
- R27 测试必须证明：第一次 close 被强制失败、错误被保留、随后真实 close 被调用且成功、无目标锁、无该 gate backend 残留。可在 test helper 暴露只读 cleanup trace/回调或连接 PID 作为证据，不得修改生产代码。
- 若需要证明“unlock 失败且首次 close 失败”的组合，注入必须覆盖 cleanup release/close 的准确顺序，而非让真实 unlock 提前消除目标条件。

### P1-R32 所有 cleanup 失败均进入显式错误累积器（高）

**现状**：runner settle timeout、monitor end 和 runner client end 仍使用 `.catch(() => undefined)`；`cleanupError === undefined` 又把 cleanup `throw undefined` 当作无错误。

**修订**：

- 使用带独立 `hasError` 状态的 cleanup error accumulator，不得以 truthiness 或 `undefined` sentinel 判断是否捕获错误。
- runner settle、gate close、monitor close、每个 runner client close 的失败全部记录；不得静默吞掉。
- 最终结果规则必须确定：有 primary 与 cleanup 时抛 AggregateError/等价结构；只有 cleanup 时抛 cleanup aggregate；无错误才返回 result。
- 增加 cleanup `throw undefined` 和 runner-settle/connection-close 至少各一个代表性注入回归，证明错误不丢失且其余资源仍继续 best-effort 清理。所有注入只属于 test helper。

### P1-R33 用一个共享 harness 消除清理断言重复（低）

`assertBoundedRaceCleanupFailure` 与 `assertBoundedRaceRejection` 仍重复 monitor 创建/关闭、计时和残留锁循环。合并为一个共享 harness，通过调用方回调检查 rejection reason；保留业务断言可读性。

### P1-R34 修正实施记录（中）

更新 record：R26/R28 可保持关闭；R27/R29 在 R31～R33 完成后才声明闭环；记录第七轮指令/基线、真实测试定位和命令摘要。不得预写未知最终 HEAD。

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
git diff --check b8c33bb5f3c4e7c3fb4fef69aa348ab9010641f6..HEAD
```

## 5. 禁止项与完成定义

- 禁止修改生产代码、schema、migration；禁止启动 P2/P3/M6。
- 禁止修改本指令、PRD/design/implement/task status；禁止 merge/rebase/reset/push/deploy/归档。
- 禁止依赖升级和无关重构。
- 只提交一个聚焦整改 commit，建议：`test(m5-p1): complete deterministic race cleanup`。
- R31～R34 全部关闭、质量门如实记录、工作区干净后，仅声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: b8c33bb5f3c4e7c3fb4fef69aa348ab9010641f6
status: M5 P1 第七轮整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R31 ...
- P1-R32 ...
- P1-R33 ...
- P1-R34 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 第七轮整改已交 Codex 审核，未启动 P2。”**
