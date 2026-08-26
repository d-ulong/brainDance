# M2 验收矩阵

> 2026-08-26 复审修订（`planning-rereview-9c87d40.md` 阻断 #1–#8）。

## 1. 总览

| 类别 | 条目 |
| --- | --- |
| 功能 AC | 8 |
| 失败路径 AC | 21（F1–F21） |
| E2E | 1 spec × 2 projects（各完整 1–7） |
| NF | NF-1–NF-8 |

## 2. 功能 AC

| ID | 条件 | 测试 |
| --- | --- | --- |
| AC-M2-1 | 20:00 计划 + 30d；maintain 按钮滚动 | formal-plan + maintain-horizon |
| AC-M2-2 | occurrence_key UNIQUE | schedule-generation |
| AC-M2-3 | fact：idempotency_key + completion_kind | schedule-complete |
| AC-M2-4 | on_time/late 均 +10；explanation 含 kind | settlement-ledger + E2E |
| AC-M2-5 | balance = sum(ledger) | settlement + E2E |
| AC-M2-6 | 编辑自 effective_from 生成 | formal-plan (F19) |
| AC-M2-7 | desktop + mobile-360 各完整 1–7 | m2-schedule-points-flow |
| AC-M2-8 | audit + outbox；create 回放无重复 | schedule-outbox (F21) |

## 3. 失败路径

| ID | 场景 | 测试 |
| --- | --- | --- |
| F1 | 未授权 | schedule-auth |
| F2 | 停用 | formal-plan |
| F3 | 已完成异键 complete | schedule-complete |
| F4 | 结算幂等 | settlement-ledger |
| F5 | GET 不写库 | schedule-query |
| F6 | effective expired 只读 | schedule-query + unit |
| F7 | 窗口外 complete | schedule-complete |
| F8 | 维护 persist expired | formal-plan + maintain |
| F9 | 创建幂等回放/409 | command-idempotency |
| F9b | active plan + 新 key 409；同 key 200 | formal-plan |
| F10 | 编辑/停用/启规则 hash | command-idempotency |
| F11 | complete 回放 | command-idempotency |
| F12 | 同 key 不同 student | command-idempotency |
| F13 | 跨命令类型同 key 允许 | command-idempotency |
| F14 | maintain 回放；无 mount/GET 触发 | maintain-horizon |
| F15 | late +10；窗口外无 ledger | complete + settlement |
| F16 | complete/skip 同 key 409 | schedule-skip |
| F17 | skip 无 ledger | schedule-skip |
| F18 | **窗口外 skip → expired + 409** | schedule-skip |
| F19 | **编辑后 effective_from 有新实例** | formal-plan |
| F20 | **同 item 同 key 异 actor → 409** | complete + skip |
| F21 | **create 回放无二次 horizon/outbox** | formal-plan + outbox |

## 4. 幂等与 schema

| 项 | 规范 |
| --- | --- |
| schedule_events UNIQUE | `(schedule_item_id, idempotency_key)` 资源级 |
| 跨 actor 同 key | 409，不回放 |
| completion_kind | schedule_events + fact_versions 必填（complete） |
| horizon_maintains | 仅独立 POST；内联不写 |
| maintain body | 空；固定 30 天 |

## 5. E2E

desktop-chromium：步骤 1–7 完整。mobile-360（360×800）：步骤 1–7 完整。

## 6. 非功能

| ID | 条件 |
| --- | --- |
| NF-1 | M1 回归 53 + E2E 10 |
| NF-2 | 360px 无横向滚动 |
| NF-3 | 写操作 Idempotency-Key |
| NF-4 | GET 零写库 |
| NF-5 | 无 command_log；0008–0013 |
| NF-6 | time-policy 扩展 |
| NF-7 | 无 mount maintain POST |
| NF-8 | `git diff --check` 通过 |

## 7. 复审阻断映射

| 阻断 | 闭合位置 |
| --- | --- |
| #1 自包含 | prd.md 全文 AC；implement.md §5–7 |
| #2 事件幂等 scope | design §4.3；矩阵 §4 |
| #3 编辑 horizon | design §5.2；F19 |
| #4 skip 窗口 | design §5.4b；F18 |
| #5 completion_kind | design §4.4；AC-M2-3/4 |
| #6 内联/独立边界 | design §5.8；F21 |
| #7 显式按钮 | design §5.8C；NF-7 |
| #8 格式 | implement 无尾随空格 |
