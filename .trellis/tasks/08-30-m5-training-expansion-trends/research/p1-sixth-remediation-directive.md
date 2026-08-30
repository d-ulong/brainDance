# M5 P1 第六轮集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定审核 SHA / 整改基线：`d7dc70b9b2316cd0ef80df5c43231f63ca0bf5af`
>
> 第五轮指令提交：`804930f3b85f60264b05c059d7c23cc0e88c2128`
>
> 结论：**NO-GO；必须一次性关闭 P1-R26～P1-R30，禁止启动 P2。**

## 1. 审核结论

R24 已关闭；R23 的单一状态和一次 settle 方向正确，但现有测试没有命中真实 unlock 失败点，且 connection close/异常传播仍存在缺口。

Codex 独立完整质量门全部退出 0：training unit 4/41、migrations 6/35、training integration 4/31、outbox/audit 3/23、typecheck、format；lint 0 error / 3 个既有 warning。绿测无法证明错误的测试路径。

## 2. 必读与允许范围

完整读取本文件、`research/p1-fifth-remediation-directive.md`、P1 implementation record 与 backend error-handling/code-reuse 规范。

只允许修改 `tests/helpers/training-submit-race.ts`、对应并发测试和 P1 implementation record。不得修改生产代码、schema、migration、任务规格或状态。

## 3. 全部整改项

### P1-R26 在真实 unlock 操作点验证 throw/false，并传播可诊断错误（高）

**现状**：`injectGateUnlockFailure` 只传给 finally cleanup；正常路径的 `queryAdvisoryUnlock` 不使用注入。两个 R23 测试故意让 runners 获取另一个 key，先发生 observation timeout，最终断言的也是 timeout。它们没有证明真实 release 点的 unlock throw/false 行为，且 cleanup 注入错误被吞掉。

**修订**：让测试注入作用于完成“全部 submit backends waiting”之后的实际 unlock 调用。测试 runners 必须等待 gate 的同一个 key，先证明 observation 成功，再分别强制 unlock throw 和 false；断言返回错误明确标识 unlock failure，而非 observation timeout；随后证明 gate 被关闭、runners 有界结束、目标锁为 0。测试控制仅存在于 test helper。

### P1-R27 gate 关闭失败不得伪装为 closed（高）

**现状**：`closeGateConnection` 吞掉 `gate.end()` 错误并无条件设置 `closed`，可能在连接仍持 session lock 时继续等待 runners，也无法诊断关键清理失败。

**修订**：只有确认 connection termination 后才能进入 closed；关闭失败必须形成可诊断 cleanup error。定义确定的错误优先级：保留 primary error，同时将 cleanup error 作为 cause/AggregateError 或等价结构暴露；不得静默吞错。增加强制 gate close failure 的测试，证明不会报告成功/closed；若测试环境无法物理终止 mock connection，应明确验证诊断错误和后续 best-effort client cleanup，且测试自身不得泄漏真实连接。

### P1-R28 任意 thrown value 都必须传播（中）

**现状**：`if (primaryError)` 会吞掉 `throw undefined/null/false/0`，随后返回未初始化的 `result!`。

**修订**：使用独立 caught 标志或唯一 sentinel，不得用 truthiness 判断异常。增加至少 `throw undefined` 回归，验证 cleanup 后仍 reject/throw，而不是返回 undefined。移除不安全的 `result!`，以类型可证明的控制流返回结果。

### P1-R29 消除四个清理测试的重复结构（低）

四个测试重复 monitor 创建、`try/finally`、耗时上限与零残留锁断言。按 code-reuse guide 提取最小测试 helper，统一 monitor 生命周期、bounded elapsed 和 no-lock 证据；不得抽象业务断言或扩大范围。

### P1-R30 修正实施记录（中）

更新 record：R24 可保持关闭；R23/R19 只有在 R26～R28 通过后才声明闭环；记录第六轮指令/基线、R26～R30 的真实测试定位和命令摘要。不得预写未知最终 HEAD。

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
git diff --check d7dc70b9b2316cd0ef80df5c43231f63ca0bf5af..HEAD
```

## 5. 禁止项与完成定义

- 禁止修改生产代码、schema、migration；禁止启动 P2/P3/M6。
- 禁止修改本指令、PRD/design/implement/task status；禁止 merge/rebase/reset/push/deploy/归档。
- 禁止依赖升级和无关重构。
- 只提交一个聚焦整改 commit，建议：`test(m5-p1): prove cleanup error propagation`。
- R26～R30 全部关闭、质量门如实记录、工作区干净后，仅声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: d7dc70b9b2316cd0ef80df5c43231f63ca0bf5af
status: M5 P1 第六轮整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R26 ...
- P1-R27 ...
- P1-R28 ...
- P1-R29 ...
- P1-R30 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 第六轮整改已交 Codex 审核，未启动 P2。”**
