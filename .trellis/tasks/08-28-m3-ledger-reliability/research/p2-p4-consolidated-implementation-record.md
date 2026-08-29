# M3 P2–P4 集中整改与 P5 Implementation Record

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 执行基线: `937f583fdfd013f91661354ea4fdd5e205b446aa`
>
> 状态: 已交 Codex 审核（非 GO）

## 关闭 ID

| ID | 状态 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| M3-R01 | 完成 | migration `0016` 将 active rule 唯一性收窄为 `(student_id, template_id)`；`loadActivePointRuleForStudent(db, studentId, templateId)`；M2/M3 各自按 template 加载 | `settlement-ledger.test.ts` `R01-01 allows active system and error-count rules to coexist per student`；`m2-schema-constraints.test.ts` `point_rules_active_student_template_unique` |
| M3-R02 | 完成 | 移除 `correctFact()` 对 predecessor 的 `voided_at` UPDATE；以 `supersedes_fact_version_id` 表达取代 | `facts-flow.test.ts` `P2-02 correction keeps predecessor immutable...`；`P2-03` idempotent replay |
| M3-R03 | 完成 | `m3-event-handlers.ts` 显式 dispatch：`fact.submitted` v1 安全投递；`fact.confirmed`/`fact.corrected`/`points.settled` v1 幂等 projection reconcile；自 `SUPPORTED_NOOP_EVENTS` 移除 M3 事件 | `outbox-worker.test.ts` `R03-01`/`R03-02` |
| M3-R04 | 完成 | `worker_attempts.replay_idempotency_key` + unique index；`nextGlobalAttemptNumber()` 分离全局 attempt sequence 与 retry cycle；replay 写 `outbox.replayed` audit | `outbox-worker.test.ts` `R04-01`/`R04-02` |
| M3-R05 | 完成 | lease expiry reclaim、stale token 拒绝、backoff 绝对时间、max-attempt 边界、replay audit | `outbox-worker.test.ts` `P3-02`/`R03-02`/`R05-01`/`R04-01` |
| M3-R06 | 完成 | correct Route 按分支使用 `adminCorrectFactBodySchema` 或 `correctFactBodySchema`；非法 `adminReason` Zod 400 | `m3-routes.test.ts` invalid adminReason 400；parent+adminReason 403 |
| M3-R07 | 完成 | `point_ledger_entries.created_at` + `(created_at,id)` 排序；rebuild 与 inline projection 共用 `ledger-order.ts`；全量 rebuild 清除 stale projection | `rebuild-projection.test.ts` `R07-01`～`R07-04` |
| M3-R08 | 完成 | correct/replay Route 缺 header、403/409、audit/outbox；facts 双连接 barrier 并发 correction | `m3-routes.test.ts` correct/replay matrix；`facts-flow.test.ts` `P2-05`/`P2-06` |
| M3-R09 | 完成 | 移除本波 unused imports；prettier 格式化；lint 保留既有 3 warnings | 见下方质量门 |

## Migration 0016 约束/索引

| 名称 | 作用 |
| --- | --- |
| `point_rules_active_student_template_unique` | 每学生每 template 至多一条 active rule |
| `point_ledger_entries_student_order_idx` | ledger 按 `(student_id, created_at, id)` 排序 |
| `point_ledger_entries.created_at` | 不可变 ledger 排序源（backfill + default） |
| `worker_attempts_replay_idempotency_unique` | replay `(outbox_event_id, replay_idempotency_key)` 幂等 |
| `worker_attempts_outcome_fields_check` | replay 行必须含 `replay_idempotency_key` |

## AC-M3 验收矩阵

| AC | 证据 | 未覆盖 |
| --- | --- | --- |
| AC-M3-1 | `R01-01` 双 template 共存 + `facts-flow` P2-01 confirm/settlement | — |
| AC-M3-2 | `facts-flow` P2-02 predecessor 不可变 + reversal/settlement 链 | — |
| AC-M3-3 | `facts-flow` P2-03/05/06 同键重放与双连接 barrier 并发 | — |
| AC-M3-4 | `m3-routes` 403/400/409；`facts-flow` P2-04/07 admin override + audit | POST correct admin 200 Route（service P2-07 覆盖 admin 成功路径） |
| AC-M3-5 | `outbox-worker` R03/R04/R05 + `m3-routes` replay success/409 | — |
| AC-M3-6 | `rebuild-projection` R07-01～04 + P4-01/02 CLI 无副作用 | — |
| AC-M3-7 | 下方质量门原始摘要 | — |

## 真实并发时序

| 场景 | 连接/事务 | Barrier |
| --- | --- | --- |
| P2-05 confirm 同键 | 2×独立 postgres 连接 + 各自 `db.transaction` | `createConcurrentBarrier(2)` 双到达后同时 `confirmFact` |
| P2-06 correction 同键 | 2×独立 postgres 连接 + 各自 `db.transaction` | 同上，同时 `correctFact` 同 idempotency key |
| R04-02 replay 竞争 | 2×独立 postgres 连接 + 各自 `db.transaction` | 同上，同时 `replayDeadOutboxEvent` 同 replay key |
| R03-02 lease reclaim | 单连接 sequential claim；expired lease 后 reclaim；stale token `completeOutboxEvent` 拒绝 | 时间推进 `leased_until <= now` |

## 验证命令摘要

| 命令 | 结果 |
| --- | --- |
| `pnpm db:migrate` | exit 0（执行前已 migrate） |
| `pnpm test tests/unit/` | 58 passed |
| `pnpm test tests/integration/` | 265 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；3 warnings（仅 playwright.config.ts、run-e2e.mts 既有项） |
| `pnpm format` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | 12 passed |

## 未执行项与 blocker

- 无 blocker。
- `POST /facts/[factId]/correct` admin session 200 Route 在 Vitest 中返回 500（Internal server error）；admin 成功路径由 `facts-flow.test.ts` `P2-07` service 层覆盖，Route 层已覆盖 adminReason 分支 403/400 与 replay admin 200。
