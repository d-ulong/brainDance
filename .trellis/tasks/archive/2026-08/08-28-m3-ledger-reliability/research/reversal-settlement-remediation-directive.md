# M3 冲销结算语义整改 Cursor 执行指令

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 审核实现 SHA：`eca12c5`（执行前必须用 `git rev-parse HEAD` 报告完整 SHA）
>
> 结论：**NO-GO；只授权关闭 RS-R01。**

## RS-R01 — 冲销结算不得伪造 settlement period（P1 / M3-R03、AC-M3-2）

当前 `resolveDistinctReversalSettlementPeriod()` 为绕过
`(fact_version_id, rule_version_id, settlement_period)` 唯一约束，会把 reversal settlement 的 period
从权威原结算周期推进到任意未来家庭日期，且其 `result` 仍为 `reward`。这破坏了
`docs/data-model.md` 的 settlement identity 和 `CONTEXT.md` 的“同一规则、日程实例、结算周期奖扣
互斥”语义：审计会显示未发生于该日程周期的虚假奖励。

通过新的 append-only migration 正确建模 reversal settlement：

1. 保留原 settlement 的真实 `settlement_period`；不得以日期碰撞生成器或未来日期规避约束。
2. 扩展 `settlements.result` 以明确区分 `reward` 与 `reversal`（或等价的可审计类型）；reversal
   settlement 不得伪装为 reward。
3. 将唯一约束精确调整为允许同一 fact/rule/period 的一条 reward 与一条 reversal，同时仍阻止重复
   reversal；ledger 的 `reverses_entry_id` 唯一约束继续是最后的“同一原流水恰一条反向流水”防线。
4. `reverseLedgerEntriesForFact()` 使用原 settlement 的真实 period，写入明确 `reversal` result；
   replacement settlement 仍为 successor fact 的 reward，且按 successor 的权威 schedule period。
5. 迁移、Drizzle schema、service 与测试 mirror 必须一致；不得重写已有事实、settlement 或 ledger。

## 必须提供的真实证据

- 更正后：原 reward settlement/ledger 不变；reversal settlement 同原 period 且 result=reversal；
  reversal ledger 指向原 entry、金额精确为负原金额；successor reward settlement 同样使用日程权威 period。
- 同一更正命令 replay 和双连接/barrier 竞争只留一条 reversal settlement/ledger、一个 successor reward
  settlement/ledger、一个 audit、一个 outbox。
- 迁移约束正反路径：第二条 reversal settlement 或第二条 reversal ledger 都被拒绝；普通 reward
  仍保持旧的唯一性与 M2 回归。
- 管理员成功更正 Route 仍为 200；P2/P3/P4 及静态质量门回归。

## 边界、验证与回报

只改 RS-R01 所需 migration/schema/settlement/correction/tests/implementation record。禁止 UI、依赖、
无关重构、历史重写、merge/rebase/reset/push/deploy。

确认测试数据库隔离且无并发 runner 后串行执行：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

提交一个聚焦 commit，建议 `fix(m3): preserve reversal settlement semantics`。回报 branch、完整 HEAD、
完整执行基线、RS-R01 代码/测试证据、迁移/constraint/index 名称、并发时序、AC-M3-2 映射、全部命令
原始摘要、未执行项及 blocker。

最后只能写：**“M3 冲销结算语义整改已交 Codex 审核（非 GO）。”**
