# M2 冻结放行门禁

> 审计基线：`2792418`（2026-08-26）。本文件是 Cursor 整改范围的冻结快照；执行仍以 `cursor-remediation.md` 的 R-ID 为准。

## 判定规则

- 下列两项是当前仅有的放行阻断。
- Cursor 只修 R9、R10，不得借机新增架构、代码、迁移或改变 M2 范围。
- 下一轮 Codex 复审只验证本表和既有 `planning-signoff-checklist.md`；非违反本表/既有门禁的优化建议一律标为非阻断。

| 冻结 ID | 对应 | 失败位置 | 必须关闭的条件 | 验证 |
| --- | --- | --- | --- | --- |
| FG-01 | R9 / F22 | `design.md` §5.2、§5.8A | `effectiveEndDate` 与 `updatedPlan` 是编辑后取消、horizon、生成的唯一输入；`horizonThrough` 与领域对象统一使用 `end_date`，不依赖 UPDATE 后对象自动刷新。 | `plan-end-date.test.ts` + `formal-plan.test.ts`：缩短、扩展、未改结束日；`horizon-through.test.ts`：end_date/NULL。 |
| FG-02 | R10 / B3 / G2 | `design.md` §5.1、§5.2、§5.6 | 三段命令算法没有 `...`、`…`、`同前`、`等同理`；各字段来源与保留/更新语义完整。 | 算法区静态检查零占位；保留命令测试映射。 |

## 已审计通过的范围

- 规格 checklist C1–C12（其中 C6 仅指 `settlement_period = family_date`）。
- 首轮 A1–A9、自包含 B1/B2/B4/B5、可追溯 D1–D4、门禁 E1–E3。
- R1–R8：字段统一、版本唯一、skip reason、M2 缩窄与 ledger CHECK/FK、三路径字段、version slot、编辑旧 slot 顺序、提交证据。
- `git diff --check 9c9a1a6...2792418` 通过；任务仍为 `planning`，没有 M2 业务代码/迁移。

## 放行条件

FG-01 与 FG-02 均通过后，Codex 只需对本文件逐项复核；全部 PASS 即写 `research/planning-signoff.md`，给出 GO/NO-GO，不再创建新的整改 ID，除非 Cursor 改动了本冻结范围外的合同。
