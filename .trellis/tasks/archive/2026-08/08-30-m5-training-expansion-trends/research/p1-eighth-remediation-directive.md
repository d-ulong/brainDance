# M5 P1 第八轮集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定审核 SHA / 整改基线：`6f39d5f5eb68fead9a395e4cbc18682357f984aa`
>
> 第七轮指令提交：`f52728aae12d083a7b23200f02f8f7c430dc5bba`
>
> 结论：**NO-GO；必须一次性关闭 P1-R35～P1-R38，禁止启动 P2。**

## 1. 审核结论

R32 的 accumulator/undefined 保存和 R33 已关闭。R31/R27 仍未命中要求的持锁清理顺序；monitor/runner close 注入也会跳过真实 termination。

## 2. 必读与允许范围

完整读取本文件、`research/p1-seventh-remediation-directive.md`、P1 implementation record 和 backend error-handling/quality 规范。

只允许修改 `tests/helpers/training-submit-race.ts`、对应并发测试和 P1 implementation record。不得修改生产代码、schema、migration、任务规格或状态。

## 3. 全部整改项

### P1-R35 unlock 失败后禁止再次 unlock，必须以 connection termination 释放锁（高）

**现状**：post-observation unlock 注入失败后 phase 仍为 `holding`；finally 先调用 `releaseGateLockOrClose`，它再次执行真实 `pg_advisory_unlock` 并设置 released。随后才记录模拟 close failure。因此测试仍在锁已消失后验证 close，违反第七轮“不能先真实 unlock 消除目标条件”。

**修订**：

- gate phase 必须包含明确的 `unlock_failed`（或等价）状态；post-observation unlock throw/false 后进入该状态。
- cleanup 遇到 `unlock_failed` 时禁止再次调用 `pg_advisory_unlock`；唯一释放路径是终止 gate connection。
- close failure 注入作用于持锁 gate 的第一次 termination attempt；记录失败后立即执行不带注入的真实 `gate.end()`。
- 测试用 gate PID 和 `pg_locks` 证明顺序：unlock failure 后该 PID 仍持目标锁；首次 close 被注入失败；最终真实 close 后 PID 消失且锁为 0。trace 必须来自数据库观察或实际调用结果，不得仅靠预先给 boolean 赋值自证。

### P1-R36 所有连接统一采用“一次失败 + 最终真实 close”（高）

**现状**：`monitor_close_throw`、`runner_client_close_throw` 在 `client.end()` 前抛错，catch 只累积错误，没有不带注入的最终 close；对应测试只检查 advisory lock，无法发现连接泄漏。

**修订**：提取一个共享 connection termination helper：可注入一次失败并记录，随后无条件尝试真实 `client.end()`；真实 end 再失败也记录。gate、monitor、runner clients 均使用这一生命周期或同一明确语义。测试记录 monitor/runner backend PID，分别证明注入错误保留且最终 PID 消失。不得以 GC 或进程退出作为清理证据。

### P1-R37 清理观察器与测试 monitor 不得覆盖或吞掉错误（中）

**现状**：`onCleanupTrace` 在 finally 外层错误捕获之外执行，callback throw 会覆盖 primary/cleanup errors；共享测试 harness 和嵌套 monitor 仍有 `.catch(() => undefined)`。

**修订**：

- cleanup observer/callback 的异常进入同一个 accumulator，不得覆盖既有错误；更简单时可将不可变 trace 放入结构化结果/错误 metadata，避免执行 callback。
- 测试 monitor 的 close 也必须通过 finally 显式传播或与测试失败组合，不得 silent swallow。
- 增加 observer throw 代表性回归，证明 primary 与 observer cleanup error 均保留；清除本次范围内所有空 catch/`.catch(() => undefined)`。

### P1-R38 修正实施记录（中）

更新 record：R32/R33 可保持关闭；R31/R27 只有在 R35/R36 数据库 PID/lock 证据通过后才闭环；记录第八轮指令/基线、R35～R38 测试定位和全部命令摘要。不得预写未知最终 HEAD。

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
git diff --check 6f39d5f5eb68fead9a395e4cbc18682357f984aa..HEAD
```

## 5. 禁止项与完成定义

- 禁止修改生产代码、schema、migration；禁止启动 P2/P3/M6。
- 禁止修改本指令、PRD/design/implement/task status；禁止 merge/rebase/reset/push/deploy/归档。
- 禁止依赖升级和无关重构。
- 只提交一个聚焦整改 commit，建议：`test(m5-p1): terminate every injected cleanup connection`。
- R35～R38 全部关闭、质量门如实记录、工作区干净后，仅声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: 6f39d5f5eb68fead9a395e4cbc18682357f984aa
status: M5 P1 第八轮整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R35 ...
- P1-R36 ...
- P1-R37 ...
- P1-R38 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 第八轮整改已交 Codex 审核，未启动 P2。”**
