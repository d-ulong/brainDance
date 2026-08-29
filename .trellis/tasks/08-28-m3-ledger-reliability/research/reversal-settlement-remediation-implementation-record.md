# M3 冲销结算语义整改 Implementation Record

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 执行基线: `3836be5b74b9102984ded13be6b5239df0b141e2`
>
> 状态: 已交 Codex 审核（非 GO）

## 关闭 ID

| ID | 状态 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| RS-R01 | 完成 | `0017` 扩展 `settlements.result` 为 `reward`/`reversal`；唯一约束改为 `(fact_version_id, rule_version_id, settlement_period, result)`；`reverseLedgerEntriesForFact()` 保留原 settlement period 并写入 `result=reversal`；移除 `resolveDistinctReversalSettlementPeriod()` | `facts-flow.test.ts` `RS-R01 preserves reversal settlement period and result semantics`；`P2-02`/`P2-06`；`m3-schema-constraints.test.ts` `P1-03`/`P1-R01`；`m2-schema-constraints.test.ts` settlements unique/result；`m3-routes.test.ts` `F-R01` |

## Migration / 约束 / 索引

| 名称 | 动作 |
| --- | --- |
| `0017_m3_reversal_settlement_semantics.sql` | append-only migration |
| `settlements_result_check` | `reward` / `reversal` |
| `settlements_fact_rule_period_result_unique` | 替换 `settlements_fact_rule_period_unique` |
| `point_ledger_entries_reversal_unique` | 不变；每原 ledger entry 仅一条 reversal |

## AC-M3-2 映射

| 场景 | 证据 |
| --- | --- |
| 原 reward settlement/ledger 不变 | `RS-R01` test |
| reversal settlement 同原 period 且 `result=reversal` | `RS-R01` test |
| reversal ledger 负金额指向原 entry | `RS-R01` / `P2-02` |
| successor reward 使用日程权威 period | `RS-R01` test |
| 同键 replay / 双连接 barrier 仅一条 reversal 链 | `P2-03` / `P2-06` |
| 第二条 reversal settlement / ledger 被拒绝 | `m3-schema-constraints` `P1-03` / `P1-R01` |
| M2 reward 唯一性回归 | `m2-schema-constraints` settlements 段 |
| 管理员更正 Route 200 | `m3-routes.test.ts` `F-R01` |

## 真实并发时序

| 场景 | 连接/事务 | Barrier |
| --- | --- | --- |
| P2-06 同键更正 | 2×独立 postgres 连接 + 各自 transaction | `createConcurrentBarrier(2)` 在 `correctFact` 入口双到达；仅 1 successor、1 reversal settlement、1 reversal ledger |

## 验证命令摘要

> 数据库: 本地隔离测试库；串行执行，无并发 runner

| 命令 | 结果 |
| --- | --- |
| `pnpm db:migrate` | exit 0 |
| `pnpm test` | exit 0；45 files / 328 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；3 warnings（既有项） |
| `pnpm format` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | exit 0；12 passed |

## 未执行项与 blocker

- 无 blocker。
