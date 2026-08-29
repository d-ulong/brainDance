# M3 P1 整改与 P2–P4 Implementation Record

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 执行基线: `143c7ae16215f0a24d1e8be83991538bf47226ca`
>
> 状态: 已交 Codex 审核（非 GO）

## 关闭 ID

| ID | 状态 | 证据 |
| --- | --- | --- |
| P1-R01 | 完成 | `0015` `point_ledger_entries_reversal_unique`；`P1-R01 allows only one reversal per original ledger entry` |
| P1-R02 | 完成 | `outbox_events_claim_pending_idx` + `outbox_events_claim_expired_lease_idx`；P1-04 indexdef 断言 |
| P1-R03 | 完成 | `outbox_events_attempts_nonneg_check`、`worker_attempts_*` CHECK；P1-04 正反路径 |
| P1-R04 | 完成 | P1-02 负值/非整数/缺字段/有效 0（`submitted_by` fixture） |
| P1-R05 | 完成 | `P1-R05 upgrades from 0014 schema through 0015 remediation`；m2 migration head 0015 |
| P2 | 完成 | `facts-flow.test.ts` + `m3-routes.test.ts` |
| P3 | 完成 | `outbox-worker.test.ts` + admin dead/replay routes |
| P4 | 完成 | `rebuild-projection.test.ts` + `scripts/rebuild-projection.ts` |

## Migration 0015 约束/索引

| 名称 | 作用 |
| --- | --- |
| `point_ledger_entries_reversal_unique` | 每个原 ledger entry 仅一条 reversal |
| `outbox_events_claim_pending_idx` | pending 支 claim |
| `outbox_events_claim_expired_lease_idx` | expired-lease 支 claim |
| `outbox_events_attempts_nonneg_check` | attempts ≥ 0 |
| `worker_attempts_attempt_number_positive_check` | attempt_number > 0 |
| `worker_attempts_outcome_fields_check` | finished_at / replay 字段完整性 |
| `schedule_error_count_v1` template seed | 错误数规则模板 |

## Route → 测试映射

| Route | 测试 |
| --- | --- |
| `POST .../facts/error-count` | `m3-routes` Idempotency-Key/403 |
| `POST .../facts/[factId]/confirm` | `m3-routes` 403 student；`facts-flow` P2-01/03/05 |
| `POST .../facts/[factId]/correct` | `facts-flow` P2-02/03/04 |
| `GET /api/admin/outbox/dead` | `m3-routes` admin/parent |
| `POST /api/admin/outbox/[eventId]/replay` | `outbox-worker` P3-04 |

## 验证命令摘要

| 命令 | 结果 |
| --- | --- |
| `pnpm db:migrate` | exit 0 |
| `pnpm test tests/integration/migrations/` | 23 passed |
| `pnpm test tests/integration/settlement/settlement-ledger.test.ts` | 26 passed |
| `pnpm test tests/integration/outbox/outbox-transaction.test.ts` | 8 passed |
| `pnpm test tests/integration/api/` | passed |
| `pnpm test tests/integration/facts/ tests/integration/outbox/ tests/integration/settlement/` | 35+ passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm format` | exit 0 |
| `pnpm build` | exit 0 |
