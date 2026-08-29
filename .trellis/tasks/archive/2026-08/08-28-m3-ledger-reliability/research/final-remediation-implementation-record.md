# M3 最终整改 Implementation Record

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 执行基线: `4fb4d398ae369a64a93ab1c30a346c952f2212d1`
>
> 状态: 已交 Codex 审核（非 GO）

## 关闭 ID

| ID | 状态 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| F-R01 | 完成 | `reverseLedgerEntriesForFact()` 通过 `resolveDistinctReversalSettlementPeriod()` 避免 reversal settlement period 与原始 reward settlement 冲突导致 ledger settlement_id 唯一约束失败；Route 无需改动 | `m3-routes.test.ts` `F-R01 POST correct admin security returns 200...`；`F-R01 POST correct admin data_correction returns 200` |
| F-R02 | 完成 | `upsertBalanceFromLedgerEntry()` 在 per-student `users` 行 `FOR UPDATE` 串行化 projection 读写 | `settlement-ledger.test.ts` `F-R02 concurrent projection upsert preserves total order with out-of-order createdAt` |
| F-R03 | 完成 | `claimNextOutboxEvent()` pending/leased eligibility 绑定 `input.now`（ISO timestamptz 参数，生产未传时使用当前时间） | `outbox-worker.test.ts` `F-R03 claim eligibility uses injected now for lease expiry boundary` |
| F-R04 | 完成 | 本记录 + 下方 AC 矩阵与串行质量门 | 见下方 |

## Migration / 索引

无新增 migration；F-R02 复用既有 `users` PK 作为 per-student 串行化锚点。

## AC-M3 验收矩阵

| AC | 证据 | 未覆盖 |
| --- | --- | --- |
| AC-M3-1 | `settlement-ledger.test.ts` `R01-01`；`facts-flow.test.ts` P2-01 | — |
| AC-M3-2 | `facts-flow.test.ts` P2-02 reversal/settlement 链；`settlement-ledger.test.ts` `F-R02` 并发 projection 总序 | — |
| AC-M3-3 | `facts-flow.test.ts` P2-03/05/06 同键重放与双连接 barrier | — |
| AC-M3-4 | `m3-routes.test.ts` `F-R01` admin 200（security/data_correction）、403/400/409 矩阵；`facts-flow.test.ts` P2-04/07 | — |
| AC-M3-5 | `outbox-worker.test.ts` `F-R03`/`R03`/`R04`/`R05`；`m3-routes.test.ts` replay success/409 | — |
| AC-M3-6 | `settlement-ledger.test.ts` `F-R02` + `rebuild-projection.test.ts` R07-01～04 | — |
| AC-M3-7 | 下方质量门原始摘要 | — |

## 真实并发时序

| 场景 | 连接/事务 | Barrier |
| --- | --- | --- |
| F-R02 projection 乱序 createdAt | 2×独立 postgres 连接 + 各自 `db.transaction` | `createConcurrentBarrier(2)` 在 `beforeProjectionUpsert`（student lock 之前）双到达后同时 upsert；later entry writer 与 earlier entry writer 竞争 |
| F-R03 lease 边界 | 单连接 sequential claim | `leased_until` 在 `input.now` 前 1ms 可 reclaim；后 1ms 不可 reclaim |
| P2-05/06 facts 同键 | 2×独立 postgres 连接 | 见 P2–P4 record |
| R04-02 replay 竞争 | 2×独立 postgres 连接 | 见 P2–P4 record |

## 验证命令摘要

> 数据库: `postgresql://***@localhost:5432/braindance`（本地隔离测试库；串行执行，无并发 runner）

| 命令 | 结果 |
| --- | --- |
| `pnpm db:migrate` | exit 0 |
| `pnpm test` | exit 0；45 files / 327 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；3 warnings（`playwright.config.ts`、`scripts/run-e2e.mts` 既有项） |
| `pnpm format` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | exit 0；12 passed |

## 未执行项与 blocker

- 无 blocker。
