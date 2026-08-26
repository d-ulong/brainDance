# M2 技术设计 — 计划与固定积分闭环

## 1. 设计原则

- **Module Interface 优先**：Schedule & Facts、Settlement & Ledger 通过命令/查询 Interface 暴露；Route Handler 仅做 HTTP 适配、鉴权与 DTO 校验。
- **权威事实在 PostgreSQL**：计划版本、日程实例、事实版本、结算、流水为事实源；余额为投影。
- **Time Policy 单点**：所有 `family_date`、完成/过期窗口、`scheduled_at` 换算仅由 **`src/modules/time-policy/`** 计算；**禁止**新建 `src/modules/time/`。
- **M2 同步边界**：outbox 随事务写入，状态 `pending`；无 Worker/cron；结算在 complete 事务内 inline 执行。
- **文档自包含**：本文件与 `prd.md`、`implement.md` 为实现唯一规范来源。

## 2. 领域边界

| 实体 | 谁可写 | 不变量 |
| --- | --- | --- |
| `plans` | owner 家长 | ≤1 active formal / student |
| `plan_versions` | 计划命令 | 只追加 |
| `schedule_items` | Schedule Module | `occurrence_key` UNIQUE |
| `schedule_events` | complete/skip | 见 §4 幂等 |
| `fact_versions` | complete | 含 `idempotency_key`、`completion_kind` |
| `schedule_horizon_maintains` | **仅独立** maintain-horizon HTTP 命令 | 见 §5.8 |
| `settlements` / `point_ledger_entries` | Settlement | append-only |

## 3. 逻辑架构

```text
Browser → Route Handlers → schedule/ | settlement/ | time-policy/ (扩展) | family-access/ | audit/ | outbox/
```

## 4. 数据模型

### 4.1 表清单

`plans`, `plan_versions`, `plan_schedule_slots`, `schedule_items`, `schedule_events`, `schedule_horizon_maintains`, `fact_versions`, `point_rule_templates`, `point_rules`, `point_rule_versions`, `settlements`, `point_ledger_entries`, `point_balance_projection`（无 `goals`）。

### 4.2 关键约束

| 表 | 约束 |
| --- | --- |
| `plans` | UNIQUE `(owner_id, student_id, create_idempotency_key)`；部分 UNIQUE active formal |
| `plan_versions` | UNIQUE `(plan_id, create_idempotency_key)` |
| `schedule_events` | UNIQUE `(schedule_item_id, idempotency_key)` — **资源级 scope（选定方案）** |
| `schedule_events` | 必填列：`event_type`, `actor_id`, `completion_kind`（complete 时 `on_time`\|`late`；skip 时 NULL） |
| `fact_versions` | UNIQUE `(schedule_item_id, idempotency_key)`；必填 `completion_kind`, `occurred_at` |
| `schedule_horizon_maintains` | UNIQUE `(student_id, actor_id, idempotency_key)` |

### 4.3 日程事件幂等 scope（阻断 #2 — 已选定）

**方案：资源级 `(schedule_item_id, idempotency_key)`**，actor **不**纳入 UNIQUE。

| 情况 | 行为 |
| --- | --- |
| 同 item + 同 key + 同 actor + 同 payload hash | **200 回放**该 event（及 complete 的 fact/settlement） |
| 同 item + 同 key + **异 payload hash** | **409** |
| 同 item + 同 key + **异 actor**（即使 payload 相同） | **409** — **绝不**回放另一操作者结果 |
| 同 item + 同 key + 异 `event_type`（complete vs skip） | **409**（占同一幂等槽） |

实现：INSERT 前 SELECT；若已有行且 `actor_id` 或 hash 与当前请求不一致 → 409；若完全一致 → 回放。

### 4.4 completion_kind（阻断 #5）

| 字段 | 位置 | 规则 |
| --- | --- | --- |
| `completion_kind` | `schedule_events` | complete 必填：`on_time` \| `late`；skip 为 NULL |
| `completion_kind` | `fact_versions` | 与 event 相同，结算输入 |
| `occurred_at` | event + fact | 真实完成时刻 UTC |

**判定**（`time-policy/completion-window.ts`）：

- `on_time`：`occurred_at` 的 family_date == `schedule_item.family_date`
- `late`：窗口内且 family_date 已过计划日（仍 ≤ 窗口结束）
- 窗口外：不得写入 complete（409）

结算：两种 kind 均 +10；ledger `explanation` 必须含 `completion_kind`。

### 4.5 payload hash

各写命令权威表存 `idempotency_payload_hash`（规范化 JSON SHA-256 hex）。

## 5. 写命令设计

### 5.1 创建正式计划

```text
POST /api/family/students/:studentId/formal-plans
Headers: Idempotency-Key

顺序（强制）:
  1. 鉴权
  2. payload hash
  3. SELECT (owner_id, student_id, create_idempotency_key)
     → 命中且 hash 一致: **200 回放**（**跳过 4–7**；不二次维护、不重复 audit/outbox）
     → 命中且 hash 不一致: 409
  4. 仅未命中：assert 无其他 active formal plan
  5. INSERT plans + plan_versions v1
  6. generateHorizonInline(plan, version=v1, from=max(startDate, today), through=today+30d)
  7. persistExpiredPastWindow(student_id)
  8. audit + outbox(plan.created) — **不含** schedule.horizon_maintained
```

### 5.2 编辑计划

```text
PATCH /api/formal-plans/:planId

  1. 鉴权 owner；幂等查 plan_versions
  2. INSERT vN+1, effective_from = nextFamilyDate(now)
  3. cancel future pending（旧 version，family_date >= effective_from）
  4. generateHorizonInline(
       plan, version=vN+1,
       from=effective_from,          ← 阻断 #3：从生效日起算
       through=currentFamilyDate+30d,
       ignoreCancelled=true           ← 不计入已 cancelled 的 future 最大日期
     )
  5. persistExpiredPastWindow
  6. audit + outbox(plan.version_created) — 不含 horizon_maintained
```

**禁止**：从「含已取消实例的全表 max(future family_date)」起算；那会导致新版本 0 实例。

### 5.3 停用计划

（同前；不扩展 horizon；persistExpired + audit/outbox plan.deactivated）

### 5.4 完成日程

```text
  1. 学生鉴权
  2. 幂等查 (schedule_item_id, key) — §4.3 语义
  3. pending + 窗口外 → persistExpired → 409
  4. pending + 窗口内 → 计算 completion_kind
  5. INSERT schedule_events (complete, actor_id=student, completion_kind, occurred_at=now)
  6. UPDATE schedule_items.status=completed
  7. INSERT fact_versions (idempotency_key, completion_kind, occurred_at, ...)
  8. inline settle + audit + outbox
```

### 5.4b 跳过日程

```text
  1. 学生或关联家长
  2. 幂等 — §4.3
  3. pending + 窗口外 → persistExpired → **409**（阻断 #4；不得 skipped）
  4. pending + 窗口内 → INSERT skip event (completion_kind=NULL)
  5. status=skipped；无 fact/ledger；audit + outbox(schedule.skipped)
```

### 5.5–5.6 结算与启规则

（同前；settlement 读取 fact.completion_kind）

### 5.7 表级幂等摘要

见 §4.3；创建顺序：幂等先于 active plan 检查。

### 5.8 Horizon：内联 vs 独立命令（阻断 #6、#7）

#### A. 内联 `generateHorizonInline()`（创建/编辑事务）

| 项 | 行为 |
| --- | --- |
| 写 `schedule_horizon_maintains` | **否** |
| audit/outbox | **仅** plan.created / plan.version_created |
| 幂等键 | **无**（跟随 create/edit 幂等；create **回放时不调用**） |
| horizon | 固定 **30 天**（`through = currentFamilyDate + 30`） |
| 生成范围 | 创建：`max(startDate, today)`→through；编辑：`effective_from`→through（当前 version） |

#### B. 独立 `POST .../maintain-horizon`

```text
POST /api/family/students/:studentId/formal-plans/maintain-horizon
Headers: Idempotency-Key
Body: （空 — 阻断 #7：无 horizonDays 参数；固定 30 天）

Auth: 家长 + relationship

Transaction:
  1. 幂等 schedule_horizon_maintains (student_id, actor_id, key)
  2. assert active plan + current plan_version
  3. from = max( currentVersion 已有 future family_date 中 pending 的最远日+1, today )
     — 仅统计 **当前 version** 且 **status=pending** 的 items
  4. through = currentFamilyDate + 30
  5. generate items；persistExpiredPastWindow
  6. INSERT schedule_horizon_maintains
  7. audit + outbox(schedule.horizon_maintained)
```

#### C. UI 触发（阻断 #7）

- **禁止**页面 mount / useEffect 自动 POST。
- 家长计划/日程页提供 **「补齐日程」/「刷新未来日程」** 按钮 → 用户点击才 POST maintain-horizon。
- GET 列表/详情 **永不** 触发维护。

## 6. 完成窗口与过期

- 窗口：计划 `family_date` 当日至 **`family_date + 1` 家庭日结束**（Asia/Shanghai）。
- 窗口内迟完成：`completion_kind=late`，+10。
- GET：只读 `effectiveStatus`；不写库。
- 持久化 expired：complete/skip 窗口外尝试、内联/独立维护事务。

## 7. API 清单

| 方法 | 路径 | 角色 |
| --- | --- | --- |
| POST | `/api/family/students/[id]/formal-plans` | 家长 |
| POST | `/api/family/students/[id]/formal-plans/maintain-horizon` | 家长（显式按钮） |
| GET | `/api/family/students/[id]/formal-plans/current` | 家长、学生 |
| PATCH | `/api/formal-plans/[planId]` | 家长 owner |
| POST | `/api/formal-plans/[planId]/deactivate` | 家长 owner |
| GET | `/api/family/students/[id]/schedule-items?from&to` | 家长、学生 |
| POST | `/api/schedule-items/[itemId]/complete` | 学生 |
| POST | `/api/schedule-items/[itemId]/skip` | 学生、家长 |
| POST | `/api/family/students/[id]/point-rules` | 家长 |
| GET | `/api/family/students/[id]/points/balance` | 家长、学生 |
| GET | `/api/family/students/[id]/points/ledger?limit` | 家长、学生 |

## 8. Time Policy（`src/modules/time-policy/`）

`to-family-date.ts`, `resolve-age-band.ts`, `to-scheduled-at.ts`, `next-family-date.ts`, `family-date-range.ts`, `completion-window.ts`, `derive-completion-kind.ts`

## 9. 已批准决策

D1 inline 结算 | D2 +10 含 late | D3 30 天 + 显式 maintain 按钮 | D4 窗口对齐 CONTEXT | D5 表级 hash | D6 skip API only | D7 无 goal | D8 启规则独立

## 10. 测试策略

见 `implement.md` §4 与 `research/m2-verification-matrix.md`。
