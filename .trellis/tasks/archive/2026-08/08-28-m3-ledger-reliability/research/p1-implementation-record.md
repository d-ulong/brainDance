# M3 P1 Implementation Record — Schema and Module Contracts

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 执行起点: `5992024d176b8c52ad72f2a0b6b86ef284148937`
>
> P1 签署基线: `4561562aac76bd93a15e8a26748123e2f1cd4313`
>
> 状态: 已交 Codex 审核（非 GO）

## P1 验收 ID 状态

| ID | 状态 | 证据 |
| --- | --- | --- |
| P1-01 | 完成 | `0014_m3_ledger_reliability.sql` 与 `points.ts` / `outbox.ts` mirror；`P1-01 mirrors migration 0014 through journal head and worker_attempts table` |
| P1-02 | 完成 | 人工 `schedule.error_count` 允许/拒绝路径；系统事实 `schedule_item_id` CHECK 回归 |
| P1-03 | 完成 | `fact_versions_supersedes_predecessor_unique`；`point_ledger_entries_reversal_idempotency_unique`；冲销 CHECK |
| P1-04 | 完成 | outbox lifecycle CHECK/index；`worker_attempts` 表与 outcome/attempt unique |
| P1-05 | 完成 | `FactsError` / `OutboxError` typed codes |
| P1-06 | 完成 | M3 约束测试 + M2 migration/settlement/outbox 回归 |

## 验收证据映射

| ID | 测试 |
| --- | --- |
| P1-01 | `m3 schema constraints > P1-01 mirrors migration 0014 through journal head and worker_attempts table` |
| P1-02 | `m3 schema constraints > P1-02 allows manual error_count facts and preserves system fact invariants` |
| P1-03 | `m3 schema constraints > P1-03 enforces successor uniqueness and reversal ledger idempotency` |
| P1-04 | `m3 schema constraints > P1-04 enforces outbox lifecycle fields and worker_attempts audit shape` |
| P1-05 | `m3 schema constraints > P1-05 exposes typed facts and outbox domain error contracts` |
| P1-06 | `m3 schema constraints > P1-06 keeps M2 settlement ledger source check valid for reward entries`；`m2-schema-constraints.test.ts` 全绿；`settlement-ledger.test.ts`；`outbox-transaction.test.ts` |

## Migration 与数据库约束

**Migration:** `src/db/migrations/0014_m3_ledger_reliability.sql`

| 名称 | 作用 |
| --- | --- |
| `fact_versions_source_kind_check` | 限定 `system` / `manual` |
| `fact_versions_completion_kind_check` | 系统事实 `on_time`/`late`；人工事实 `not_applicable` |
| `fact_versions_schedule_item_binding_check` | 系统/人工事实必须绑定 `schedule_item_id` |
| `fact_versions_confirmation_pair_check` | `confirmed_at`/`confirmed_by` 成对出现 |
| `fact_versions_manual_invariants_check` | 人工 `schedule.error_count` 非负整数 + `submitted_by` |
| `fact_versions_system_invariants_check` | M2 系统完成事实不变量 |
| `fact_versions_correction_reason_check` | Successor 必须携带 `correction_reason` |
| `fact_versions_supersedes_predecessor_unique` | 同一前驱仅允许一个 successor |
| `point_ledger_entries_source_check` | 奖励流水与 `reversal` 负流水 CHECK |
| `point_ledger_entries_reversal_idempotency_unique` | 同一原流水 + 命令幂等键仅一条冲销 |
| `outbox_events_status_check` | `pending`/`leased`/`processed`/`dead` |
| `outbox_events_lease_fields_check` | `leased` 状态必须携带租约字段 |
| `outbox_events_claim_eligible_idx` | Worker claim 候选索引 |
| `outbox_events_dead_list_idx` | dead 列表索引 |
| `worker_attempts_outbox_attempt_unique` | 尝试序号唯一 |
| `worker_attempts_outcome_check` | outcome 枚举 |
| `worker_attempts_outbox_event_idx` | 按事件查询尝试 |

## 验证命令（提交前）

| 命令 | 结果 |
| --- | --- |
| `pnpm db:migrate` | exit 0；Migrations complete |
| `pnpm test tests/integration/migrations/` | exit 0；3 files；21 tests passed |
| `pnpm test tests/integration/settlement/settlement-ledger.test.ts` | exit 0；25 tests passed |
| `pnpm test tests/integration/outbox/outbox-transaction.test.ts` | exit 0；6 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；0 errors；3 个既有 warnings |
| `pnpm format` | exit 0；All matched files use Prettier code style |

## 范围外最小编译修复

- `src/modules/settlement/settlement.service.ts`：`schedule_item_id` 可空后的 null guard，仅满足 typecheck；M2 系统事实路径行为不变。

## 未覆盖

- P2～P5 service、Route、Worker、CLI、UI（未授权）
