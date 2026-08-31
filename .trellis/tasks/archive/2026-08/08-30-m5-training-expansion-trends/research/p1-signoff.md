# M5 P1 签署记录

> 状态：**GO**
>
> 固定实现 SHA：`6f39d5f5eb68fead9a395e4cbc18682357f984aa`
>
> 验收基线 SHA：`9f0418814515d2165ebba90b1e98da274ec4eacd`

## 已覆盖

- R-M5-01 / AC-M5-01：三个年龄档的不可变 Stroop、数字广度定义、启停及历史会话定义快照。
- R-M5-02 / AC-M5-02：Stroop 类型化事件校验、异常/乱序/重复边界、分类指标与干扰差值。
- R-M5-03 / AC-M5-03：数字广度顺背/倒背独立校验、长度边界、最长连续正确位数及尝试证据。
- R-M5-04 / AC-M5-04：按学生、训练 key、家庭日期隔离 effective/practice；幂等及真实 advisory-lock 并发下不重复写指标、投影、审计或 outbox。
- R-M5-08 的 P1 部分：事务内最小化审计/outbox，不包含答案或完整题目 payload。

## 独立质量证据

- 本轮：`pnpm db:migrate` 通过；training unit 为 4 files / 41 tests 全部通过；migration suite 通过；training integration 为 3 files / 36 tests 通过、1 个测试 helper 清理诊断断言失败。
- 唯一失败为 `P1-R32: runner client close failure is recorded in cleanup aggregate`：期望注入的 close 错误原文，实际得到 cleanup aggregate 错误。它只影响测试失败清理的诊断文本，不影响生产提交路径、真实并发不变量或冻结的 R/AC，依 `AGENTS.md` 三轮验收线记为非阻断技术债。
- 同一固定实现此前的独立串行记录已覆盖 outbox/audit、typecheck、format 与 diff check；lint 为 0 errors、3 个既有 warnings。本轮因 Codex 提权用量限制未再次执行这些剩余命令，不将本轮未执行表述为新通过。

## 未覆盖

- R-M5-05、AC-M5-05～07 的趋势窗口、segment、重建一致性及实时家长授权由 P2 承担。
- 训练 UI、双视口、键盘/触控与全量 E2E 由 P3 承担。
- P1-R35～R38 及上述 P1-R32 helper 诊断偏差保留为非阻断测试技术债，不再开启 P1 整改轮次。

结论：P1 生产验收线满足，准许从签署/指令提交开始执行 P2；P1 GO 不代表 M5 完成。
