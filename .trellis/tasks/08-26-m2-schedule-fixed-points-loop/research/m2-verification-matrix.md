# M2 验收矩阵

> 2026-08-26 审阅修订：maintain-horizon、迟完成窗口、payload hash、skip API、双端完整 E2E。

## 1. 总览

| 类别 | 条目数 |
| --- | --- |
| 功能 AC | 8 |
| 失败路径 AC | 17（含 F9b、F14–F17） |
| E2E | 1 spec × 2 projects（**各完整链路**） |

## 2. 功能 AC

| ID | 条件 | 测试 |
| --- | --- | --- |
| AC-M2-1 | 20:00 计划 + 30 天 horizon | formal-plan + maintain-horizon |
| AC-M2-2 | occurrence_key UNIQUE | schedule-generation |
| AC-M2-3 | fact_versions 含 idempotency_key | schedule-complete |
| AC-M2-4 | 按时/迟完成（窗口内）各 +10 | settlement-ledger + E2E |
| AC-M2-5 | 余额 = ledger 求和 | settlement + E2E |
| AC-M2-6 | 编辑次日起生效 | formal-plan |
| AC-M2-7 | **desktop + mobile-360 各完整链路** | m2-schedule-points-flow ×2 projects |
| AC-M2-8 | audit + outbox | schedule-outbox |

## 3. 失败路径 AC

| ID | 场景 | 测试 |
| --- | --- | --- |
| F1 | 未授权 | schedule-auth |
| F2 | 停用 | formal-plan |
| F3 | 已完成异键 complete | schedule-complete |
| F4 | 结算幂等 | settlement-ledger |
| F5 | GET 不写库 | schedule-query |
| F6 | effective expired（计划日+1 结束） | schedule-query + completion-window unit |
| F7 | 窗口外 complete | schedule-complete |
| F8 | 维护事务 persist expired | formal-plan + maintain-horizon |
| F9 | 创建同 key 回放 / 异 payload 409 | command-idempotency |
| F9b | 有 active plan + 新 key 409；同 key 回放 200 | formal-plan（**幂等先于 active 检查**） |
| F10 | 编辑/停用/启规则 hash | command-idempotency |
| F11 | complete 同键回放 | command-idempotency |
| F12 | 同 key 不同 student 创建 | command-idempotency |
| F13 | 跨命令类型同 key 允许 | command-idempotency |
| F14 | maintain-horizon 回放；GET 不触发 | maintain-horizon |
| F15 | 迟完成 +10；窗口外无 ledger | schedule-complete + settlement |
| F16 | complete/skip 同 key 409；complete 后 skip 异键 409 | schedule-skip |
| F17 | skip 无 ledger；家长/学生可 skip | schedule-skip |

## 4. 幂等约束（D5）

| 命令 | UNIQUE | payload hash 表字段 |
| --- | --- | --- |
| 创建计划 | `(owner_id, student_id, create_idempotency_key)` | `plans.create_idempotency_payload_hash` |
| 编辑版本 | `(plan_id, create_idempotency_key)` | `plan_versions.create_idempotency_payload_hash` |
| 停用 | `(id, deactivate_idempotency_key)` | `plans.deactivate_idempotency_payload_hash` |
| 完成/跳过 | `(schedule_item_id, idempotency_key)` | `schedule_events.idempotency_payload_hash` |
| 启用规则 | `(creator_parent_id, student_id, create_idempotency_key)` | `point_rules.create_idempotency_payload_hash` |
| 滚动维护 | `(student_id, actor_id, idempotency_key)` | `schedule_horizon_maintains.idempotency_payload_hash` |
| fact | `(schedule_item_id, idempotency_key)` | `fact_versions.idempotency_payload_hash` |

## 5. E2E（AC-M2-7）

| Project | 步骤 |
| --- | --- |
| desktop-chromium | 1–7 完整 |
| mobile-360 | 1–7 完整（360×800，无横向滚动） |

## 6. 非功能

| ID | 条件 |
| --- | --- |
| NF-4 | GET 零写库 |
| NF-5 | 无 command_log；迁移 0008–0013 |
| NF-6 | time-policy 扩展于 `src/modules/time-policy/` |
