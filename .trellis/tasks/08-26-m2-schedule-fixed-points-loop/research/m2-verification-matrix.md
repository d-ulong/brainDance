# M2 验收矩阵

> 2026-08-26 第六轮 consolidated signoff（闭合 e6ece0f 后全部已知缺口 + 复审入口包）。

## 1. 总览

| 类别 | 条目 |
| --- | --- |
| 功能 AC | 8 |
| 失败路径 AC | 28（F1–F28） |
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
| F14 | maintain 回放；并发同 key 仅 1 副作用；无 mount | maintain-horizon |
| F15 | late +10；窗口外无 ledger | complete + settlement |
| F16 | complete/skip 同 key 409 | schedule-skip |
| F17 | skip 无 ledger | schedule-skip |
| F18 | **窗口外 skip → expired + 409** | schedule-skip |
| F19 | **编辑后 effective_from 有新实例** | formal-plan |
| F20 | **同 item 同 key 异 actor → 409** | complete + skip |
| F21 | **create 回放无二次 horizon/outbox** | formal-plan + outbox |
| F22 | **endDate / cancelPendingAfterEndDate / maintain no-op 无 outbox** | plan-end-date |
| F23 | **缺 Idempotency-Key → 400** | write-route-idempotency-header |
| F24 | **并发同 key 200 回放** | schedule-terminal-concurrency |
| F25 | **首次 balance +10；回放/冲突 balance 不变；跨 item 同 key** | settlement-ledger |
| F26 | **maintain 并发同 scope+key → 1 generate/audit/outbox** | maintain-horizon |
| F27 | **编辑 localTime 未变仍建 slot 快照并生成** | formal-plan |
| F28 | **maintain no-op 仍 persistExpiredPastWindow；回放路径不 persist** | plan-end-date + maintain-horizon |

## 4. 幂等与 schema

| 项 | 规范 |
| --- | --- |
| occurrence_key | `{plan_id}:{plan_version_id}:{family_date}:daily:{localTime}` |
| schedule_events UNIQUE | `(schedule_item_id, idempotency_key)` 资源级 |
| schedule_events 状态 | `from_status`/`to_status`（非 event_type）；对齐 data-model |
| 跨 actor 同 key | 409，不回放 |
| completion_kind | schedule_events 复合 CHECK（含 reason）；fact_versions NOT NULL（complete） |
| schedule_events.reason | skip 可写；complete 必 NULL；同键回放不覆盖 |
| plans.current_version | FK → plan_versions.id（非 current_version_id）；v1 同事务 UPDATE |
| plan_versions | UNIQUE `(plan_id, version)` 与幂等键并存 |
| M2 缩窄 | fact_versions.schedule_item_id NOT NULL；ledger settlement_id/source_id NOT NULL |
| ledger source | M2：CHECK `source_type='settlement' AND source_id=settlement_id`；source_id FK → settlements |
| generateHorizonInline slot | 步骤 0 按传入 version 查 plan_schedule_slots.default；禁止读 plans.current_version |
| plan_kind | 对齐 data-model；非 plan_type |
| horizon_maintains | 仅独立 POST；内联不写 |
| maintain body | 空；固定 30 天 |

## 5. E2E

desktop-chromium：步骤 1–7 完整。mobile-360（360×800）：步骤 1–7 完整。

## 6. 非功能

| ID | 条件 |
| --- | --- |
| NF-1 | M1 回归 53 + E2E 10 |
| NF-2 | 360px 无横向滚动 |
| NF-3 | 写操作 Idempotency-Key；缺失 → 400 `IDEMPOTENCY_KEY_REQUIRED` |
| NF-4 | GET 零写库 |
| NF-5 | 无 command_log；0008–0013 |
| NF-6 | time-policy 扩展 |
| NF-7 | 无 mount maintain POST |
| NF-8 | `git diff --check` 通过 |

## 7. 复审阻断映射

| 轮次 | 阻断 | 闭合位置 |
| --- | --- | --- |
| 首轮 #1–#8 | 见 `planning-rereview-9c87d40.md` | ee79298 主体 |
| ee79298 #1 | design 自包含 | design §5.2–5.7、§4.5、§6.1 全文 |
| ee79298 #2 | §5.7 幂等表 | design §5.7 + F9–F13,F20 |
| ee79298 #3 | implement 布局 | implement §3 完整路径 |
| ee79298 #4 | 失败路径 | design §6.1 ↔ F1–F21 |
| 1b8c925 #1 | 消除省略号 | design §5.4/5.5/5.8B；prd skip 路径 |
| 1b8c925 #2 | schema 自包含 | design §4.2 settlements/fact hash 列 |
| 1b8c925 #3 | 领域/架构 | design §2–§3 Module 表 |
| 1b8c925 #4 | 过期只读 | design §6 TS + 路径表；F6 |
| 1b8c925 #5 | 测试策略 | design §10 + implement §4 |
| 1b8c925 #6 | 路由/seed | implement §2.1、§3 GET 路由 |
| e6ece0f #1 | occurrence_key | design §4.6；AC-M2-2 |
| e6ece0f #2 | 状态机 | design §4.7；F3/F16/F17 |
| e6ece0f #3 | persistExpired | design §4.8；F6/F7/F8/F18 |
| e6ece0f #4 | outbox dedupe | design §4.9；AC-M2-8/F21 |
| e6ece0f #5 | 非 pending 回放 | design §5.4/5.4b；F11/F16 |
| e6ece0f #6 | settlement/ledger | design §5.5；F4 |
| e6ece0f #7 | inline 算法 | design §5.8A；F19/F21 |
| e6ece0f #8 | AC 映射内联 | design §10；prd 无见 design |
| consolidated | §5.0 决策顺序 | design §5.0、§5.4/5.4b；checklist C9 |
| consolidated | plan_schedule_slots | design §2/§4.2；implement 0008 |
| consolidated | Web UI + maintain 按钮 | design §11；NF-7 |
| consolidated | 复审入口 | `PLANNING-REVIEW.md`；`planning-signoff-checklist.md` |
| 7804743 C3 | diff --check 范围 | `PLANNING-REVIEW.md` 审阅基线 `9c9a1a6...HEAD` |
| 7804743 C4 | 逐表迁移 | `implement.md` §2.0–§2.0.5 |
| 7804743 C6 | endDate 边界 | `design.md` §5.1/§5.2/§5.8A/B；F22 |
| 7804743 C7 | 锁后重查回放 | `design.md` §5.0；F24 |
| 7804743 C8 | Idempotency-Key 400 | `design.md` §7.1；F23 |
| 7804743 C9 | ledger 无全局 UNIQUE | `design.md` §4.2/§5.5；F25 |
| 7804743 C10 | C6–C9 测试映射 | `implement.md` §4.2.1；design §10 |
| 3e6df81 标准 C4 | 逐表迁移 + §2.0.6 交叉表 | implement §2.0–§2.0.6 |
| 3e6df81 标准 C6 | endDate + §4.8b + maintain no-op | design §4.8b、§5.8B；F22 |
| 3e6df81 规格 C11 | horizonThrough 冻结 | design §8；implement §3 |
| 3e6df81 规格 C12 | 每 version 无条件 slot 快照 | design §5.2；F27 |
| a55541a C4 | plan_kind + events CHECK + point_rules DDL | implement §2.0.3；m2-schema-constraints |
| a55541a C9 | balance EXCLUDED.balance UPSERT | design §5.5；F25 |
| a55541a C10 | F26 maintain 并发；F27 slot 快照 | maintain-horizon；formal-plan |
| a55541a C11 | maintain §5.8B 回放/占位 | design §5.8B；F14/F26 |
| a55541a C12 | §5.2 无条件 slot | design §5.2；F27 |
| 8003694 标准 C4 | 迁移 data-model 对齐 §2.0.7；from_status/to_status | implement §2.0.7；design §4.2 |
| 8003694 规格 C11 | maintain no-op 仍 persistExpired | design §5.8B 步骤 5；F28 |
| fb5f05c 标准 C4 | generateHorizonInline + fact_versions 全列 | design §5.8A；implement §2.0.2 |
| fb5f05c 规格 F28 | 回放不 persist；no-op 仍 persist | design §5.8B 2/4/5；implement §4.2.2 |
| fe5bc1a S-C4 | point_rules.active；fact/ledger 可空列 | implement §2.0.2/§2.0.3/§2.0.4 |
| fe5bc1a C8 | horizonThrough 单元 + §3.1 七 Route 400 | horizon-through.test.ts；write-route-idempotency-header |
| R1 | plans.current_version 统一 | implement §2.0/§2.0.6/§2.0.7；design §4.2/§5.1 | m2-schema-constraints.test.ts |
| R2 | plan_versions UNIQUE (plan_id, version) | implement §2.0；design §4.2 | m2-schema-constraints.test.ts |
| R3 | schedule_events.reason + 复合 CHECK | implement §2.0.1；design §5.4b | m2-schema-constraints + schedule-skip.test.ts |
| R4 | M2 缩窄 + ledger CHECK/FK | design §4.2/§5.5；implement §2.0.4/§2.0.7 | m2-schema-constraints（含负路径）+ settlement-ledger |
| R5 / C8 | 三路径 schedule_items 四字段 | design §5.8A；implement §4.2.4 | schedule-generation + formal-plan + maintain-horizon |
| R6 | generateHorizonInline 使用 version slot 快照 | design §5.8A 步骤 0；implement §3 | 三路径集成测试（occurrence_key/scheduled_at vs slot local_time） |
| R7 | 编辑 §5.2 slot 读取顺序（oldVersionId → slot → current_version） | design §5.2；implement §4.2.4 | formal-plan.test.ts（F27 未传 localTime + 改时间） |
| R9 / FG-01 / F22 | 编辑 effectiveEndDate + updatedPlan；`horizonThrough`/`generateHorizonInline` 统一 `end_date` | design §5.2、§5.8A；implement §4.2.5 | plan-end-date + formal-plan + horizon-through |
| R10 / FG-02 / B3 / G2 | §5.1/§5.2/§5.6 命令算法零占位；字段来源完整 | design §5.1、§5.2、§5.6 | schedule-generation + formal-plan + command-idempotency（F11–F13） |
