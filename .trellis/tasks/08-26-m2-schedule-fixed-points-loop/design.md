# M2 技术设计 — 计划与固定积分闭环

## 1. 设计原则

- **Module Interface 优先**：Schedule & Facts、Settlement & Ledger 通过命令/查询 Interface 暴露；Route Handler 仅做 HTTP 适配、鉴权与 DTO 校验。
- **权威事实在 PostgreSQL**：计划版本、日程实例、事实版本、结算、流水为事实源；余额为投影。
- **Time Policy 单点**：所有 `family_date`、完成/过期窗口、`scheduled_at` 换算仅由 **`src/modules/time-policy/`** 计算；**禁止**新建 `src/modules/time/`。
- **M2 同步边界**：outbox 随事务写入，状态 `pending`；无 Worker/cron；结算在 complete 事务内 inline 执行。
- **文档自包含**：本文件与 `prd.md`、`implement.md` 为实现唯一规范来源。

## 2. 领域边界

```text
Formal Plan → Plan Version → plan_schedule_slots → Schedule Items → Complete/Skip Event
      → Fact Version → Settlement → Ledger → Balance Projection
Point Template → Point Rule (per student, 独立启用)
```

| 实体 | 谁可写 | 谁可读 | 不变量 |
| --- | --- | --- | --- |
| `plans` | owner 家长 | 关联家长、学生 | ≤1 active formal / student |
| `plan_versions` | 计划命令 | 同上 | 只追加；`effective_from` 为编辑后+1 家庭日 |
| `plan_schedule_slots` | 创建/编辑计划 | 同上 | `(plan_version_id, slot_key)` UNIQUE；M2 单槽 `default` |
| `schedule_items` | Schedule Module | 关联家长、学生 | `occurrence_key` UNIQUE；状态机单向 |
| `schedule_events` | complete/skip | 同上 | 资源级 UNIQUE `(schedule_item_id, idempotency_key)`；跨 actor 同 key → 409 |
| `fact_versions` | complete 命令 | 同上 | 只追加；含 `idempotency_key`、`completion_kind` |
| `schedule_horizon_maintains` | **仅** maintain-horizon HTTP | — | 滚动维护幂等锚点 |
| `point_rule_templates` | admin/seed | 家长读 | M2 一条固定模板 |
| `point_rules` | 家长 creator | 同上 | 绑定 `student_id` |
| `settlements` | Settlement inline | 同上 | `(fact_version_id, rule_version_id, settlement_period)` UNIQUE |
| `point_ledger_entries` | Settlement inline | 同上 | append-only；无 UPDATE/DELETE |
| `point_balance_projection` | Settlement 同事务 | 同上 | 必须可由 ledger 重建 |

## 3. 逻辑架构

```text
Browser（计划表单、补齐日程按钮、日程列表、完成按钮、积分展示）
  └─ Next.js App Router
       ├─ Route Handlers（鉴权、Idempotency-Key、Zod）
       └─ Domain Modules
            ├─ schedule/              ← 新建
            ├─ settlement/            ← 新建
            ├─ time-policy/           ← 扩展（M1 已有 to-family-date.ts）
            ├─ identity/              ← 只读依赖
            ├─ family-access/
            ├─ audit/
            └─ outbox/
                 └─ PostgreSQL (Drizzle)
```

| Module | 命令 | 查询 | 禁止 |
| --- | --- | --- | --- |
| Schedule | 计划 CRUD、maintain-horizon、complete/skip | 计划、日程列表（**只读** effectiveStatus） | GET 写库；ledger 直写 |
| Settlement | 启用规则；inline settleForFact | 余额、流水 | 覆盖 fact/ledger |
| Time Policy | （纯函数）family_date、窗口、scheduled_at | — | 散落时区逻辑 |
| Family Access | — | 授权校验 | — |
| Audit / Outbox | append | — | 无 commit 无 outbox |

## 4. 数据模型

### 4.1 表清单

`plans`, `plan_versions`, `plan_schedule_slots`, `schedule_items`, `schedule_events`, `schedule_horizon_maintains`, `fact_versions`, `point_rule_templates`, `point_rules`, `point_rule_versions`, `settlements`, `point_ledger_entries`, `point_balance_projection`（无 `goals`）。

### 4.2 关键约束

| 表 | 字段（幂等） | 约束 |
| --- | --- | --- |
| `plans` | `plan_kind`, `goal_id`, `source_plan_id`, `current_version_id`, `start_date`, `end_date`, … | 对齐 `docs/data-model.md` §4；M2 `goal_id`/`source_plan_id` NULL |
| `plans` | `create_idempotency_key`, … | UNIQUE `(owner_id, student_id, create_idempotency_key)`；**部分 UNIQUE** `(student_id) WHERE status='active' AND plan_kind='formal'` |
| `plan_versions` | `version`, `schedule_rule`, `effective_from`, `effective_until`, `created_at` | 对齐 data-model；M2 幂等列 `create_idempotency_key`+hash |
| `plan_schedule_slots` | `slot_key`, `local_time` | UNIQUE `(plan_version_id, slot_key)`；M2 固定 `default` + `20:00` |
| `schedule_items` | `owner_id`, `slot_key`, `source`, `plan_snapshot`, `occurrence_key`, `status` | 对齐 data-model §4；M2 `source='plan'` |
| `schedule_events` | `from_status`, `to_status`, `idempotency_key`, `idempotency_payload_hash`, `actor_id`, `completion_kind` | 对齐 data-model §4（状态迁移）；**复合 CHECK** 见 implement §2.0.1 |
| `fact_versions` | `idempotency_key`, `idempotency_payload_hash`, `completion_kind`, `occurred_at` | UNIQUE `(schedule_item_id, idempotency_key)` |
| `schedule_horizon_maintains` | `idempotency_key`, `idempotency_payload_hash`, `actor_id` | UNIQUE `(student_id, actor_id, idempotency_key)` |
| `point_rules` | `create_idempotency_key`, `create_idempotency_payload_hash` | UNIQUE `(creator_parent_id, student_id, create_idempotency_key)` |
| `settlements` | `idempotency_key`, `settlement_period` | UNIQUE `(fact_version_id, rule_version_id, settlement_period)`；`settlement_period` = `schedule_item.family_date` |
| `point_ledger_entries` | `idempotency_key`（审计列，非 UNIQUE） | UNIQUE `settlement_id`；**无**全局 `UNIQUE(idempotency_key)` |
| `point_balance_projection` | `balance`, `last_ledger_entry_id` | PK `student_id`；`INSERT(student_id,balance)` + `EXCLUDED.balance` 累加 |

逐表 DDL 与 `implement.md` §2.0 及 **§2.0.7 data-model 对齐表** 一致；禁止未文档化的模型漂移。

### 4.3 日程事件幂等 scope（阻断 #2 — 已选定）

**方案：资源级 `(schedule_item_id, idempotency_key)`**，actor **不**纳入 UNIQUE。

| 情况 | 行为 |
| --- | --- |
| 同 item + 同 key + 同 actor + 同 payload hash | **200 回放**该 event（及 complete 的 fact/settlement） |
| 同 item + 同 key + **异 payload hash** | **409** |
| 同 item + 同 key + **异 actor**（即使 payload 相同） | **409** — **绝不**回放另一操作者结果 |
| 同 item + 同 key + 异 `to_status`（completed vs skipped） | **409**（占同一幂等槽） |

实现：INSERT 前 SELECT；若已有行且 `actor_id` 或 hash 与当前请求不一致 → 409；若完全一致 → 回放。

### 4.4 completion_kind（阻断 #5）

| 字段 | 位置 | 规则 |
| --- | --- | --- |
| `completion_kind` | `schedule_events` | **复合 CHECK**（§4.2）：complete → `on_time` \| `late`；skip → NULL |
| `completion_kind` | `fact_versions` | 与 event 相同，结算输入 |
| `occurred_at` | event + fact | 真实完成时刻 UTC |

**判定**（`time-policy/completion-window.ts`）：

- `on_time`：`occurred_at` 的 family_date == `schedule_item.family_date`
- `late`：窗口内且 family_date 已过计划日（仍 ≤ 窗口结束）
- 窗口外：不得写入 complete（409）

结算：两种 kind 均 +10；ledger `explanation` 必须含 `completion_kind`。

### 4.5 payload hash

对各写命令请求体做**规范化 JSON**（稳定键序、剔除 `Idempotency-Key` 等元字段）→ SHA-256 hex，存入各权威表的 `idempotency_payload_hash` 列。

| 规则 | 行为 |
| --- | --- |
| 同 scope + 同 key + hash 一致 | **200 回放**原结果 |
| 同 scope + 同 key + hash 不一致 | **409** |
| 跨命令类型复用同一 key | **允许**（不同权威表，见 §5.7） |

**actor 与 scope**：计划/规则类命令的 UNIQUE 含 `owner_id` / `creator_parent_id`；`schedule_events` 为**资源级** `(schedule_item_id, idempotency_key)`，actor **不**进 UNIQUE，但 §4.3 要求异 actor 同 key → **409**。

### 4.6 occurrence_key（冻结）

```text
occurrence_key = "{plan_id}:{plan_version_id}:{family_date}:daily:{localTime}"
```

- `family_date`：`YYYY-MM-DD`（Asia/Shanghai 日历日）
- `localTime`：来自当前 `plan_version` 的 `plan_schedule_slots`（M2 单槽 `default`）
- 生成：`generateHorizonInline` / 独立 maintain 均 `INSERT … ON CONFLICT (occurrence_key) DO NOTHING`

### 4.7 schedule_items 状态机

| 当前 status | 允许迁移 | 触发 |
| --- | --- | --- |
| `pending` | → `completed` | complete（窗口内） |
| `pending` | → `skipped` | skip（窗口内） |
| `pending` | → `expired` | persistExpiredPastWindow；或窗口外 complete/skip 尝试 |
| `pending` | → `cancelled` | 编辑取消 future；停用计划 |
| `completed` / `skipped` / `expired` / `cancelled` | 终态 | 异键写命令 → 409；同键 → 回放（若适用） |

### 4.8 persistExpiredPastWindow

```text
persistExpiredPastWindow(student_id):
  UPDATE schedule_items
  SET status = 'expired'
  WHERE student_id = ?
    AND status = 'pending'
    AND isPastCompletionWindow(family_date, now())   -- §6 窗口定义，非简单 family_date < today
```

**调用方（仅写事务）**：create plan、edit plan、deactivate、complete（窗口外）、skip（窗口外）、maintain-horizon。**禁止** GET/list 调用。

### 4.8b cancelPendingAfterEndDate

```text
cancelPendingAfterEndDate(student_id, end_date):
  IF end_date IS NULL: return
  UPDATE schedule_items
  SET status = 'cancelled'
  WHERE student_id = ?
    AND status = 'pending'
    AND family_date > end_date
```

**调用方**：编辑计划缩短 `plans.end_date` 时（§5.2 步骤 5）；与版本切换取消（步骤 6）独立执行。

### 4.9 Outbox 与审计（AC-M2-8）

同事务 `appendOutboxEvent` + audit；`dedupe_key` UNIQUE。

| outbox event | aggregate | dedupe_key 示例 |
| --- | --- | --- |
| `plan.created` | plan | `plan.created:{plan_id}` |
| `plan.version_created` | plan | `plan.version_created:{plan_version_id}` |
| `plan.deactivated` | plan | `plan.deactivated:{plan_id}` |
| `schedule.horizon_maintained` | student | `schedule.horizon_maintained:{maintain_id}` |
| `schedule.completed` | schedule_item | `schedule.completed:{schedule_item_id}` |
| `schedule.skipped` | schedule_item | `schedule.skipped:{schedule_item_id}` |
| `point_rule.enabled` | point_rule | `point_rule.enabled:{point_rule_id}` |
| `points.settled` | settlement | `points.settled:{settlement_id}` |

audit `action` 示例：`formal_plan.created`、`schedule_item.completed`、`point_ledger.created`。

**create 回放**：不得第二次写入 `plan.created` outbox（F21）。

### 5.0 日程事件决策顺序（complete / skip 共用）

```text
1. 鉴权（complete=学生；skip=学生或关联家长）
2. bodyHash = normalizeIdempotencyPayload(body)
3. item = SELECT schedule_items WHERE id = :itemId FOR UPDATE
4. existing = SELECT schedule_events WHERE (schedule_item_id, idempotency_key)
   -- 锁后重查：并发同 key 第二请求不得因 status 已变而误 409
   IF existing:
     IF existing.actor_id != 当前 actor OR existing.idempotency_payload_hash != bodyHash
        OR (complete 且 existing.to_status != 'completed')
        OR (skip 且 existing.to_status != 'skipped') → 409
     ELSE → 200 回放（complete 含 fact/settlement/ledger；skip 含 skip event）
5. IF item.status != 'pending' → 409
6. IF isPastCompletionWindow(item.family_date, now) → persistExpiredPastWindow → 409
7. 执行写入（complete §5.4 步骤 6–11；skip §5.4b 步骤 6–8）
```

**并发语义**：同 item + 同 key + 同 actor + 同 hash 的并发 complete/skip，仅一条终态 event/fact/settlement/ledger；后到请求在步骤 4 **200 回放**，不得 409。

`normalizeIdempotencyPayload`：稳定 JSON 键序、剔除 Idempotency-Key 头；实现于 `src/modules/schedule/normalize-idempotency-payload.ts`。

### 5.1 创建正式计划

```text
POST /api/family/students/:studentId/formal-plans
Headers: Idempotency-Key
Body: { title, description?, localTime: "20:00", startDate, endDate? }

顺序（强制）:
  1. assert parent verified + active relationship + student scope
  2. 规范化 body → idempotency_payload_hash
  3. SELECT (owner_id, student_id, create_idempotency_key)
     → 命中且 hash 一致: **200 回放**（**跳过 4–10**；不二次维护、不重复 audit/outbox）
     → 命中且 hash 不一致: 409
  4. 仅未命中：assert 无其他 active formal plan
  5. INSERT plans(plan_kind='formal', start_date, end_date, ...) + plan_versions v1
     + plan_schedule_slots(v1, slot_key='default', local_time)
  6. through = horizonThrough(plans)
  7. from = max(start_date, currentFamilyDate)
  8. IF from > through → 0 新实例
     ELSE generateHorizonInline(plans, version=v1, from, through)
  9. persistExpiredPastWindow(student_id)
 10. audit + outbox(plan.created)
```

### 5.2 编辑计划

```text
PATCH /api/formal-plans/:planId
Headers: Idempotency-Key
Body: { title?, description?, localTime?, endDate? }

  1. assert owner
  2. 规范化 body → idempotency_payload_hash
  3. SELECT plan_versions WHERE (plan_id, create_idempotency_key)
     → 命中且 hash 一致: **200 回放**该 version（跳过 4–11；不二次 inline horizon/outbox）
     → 命中且 hash 不一致: 409
  4. INSERT plan_versions vN+1（effective_from = nextFamilyDate(now)）
     UPDATE plans SET end_date = COALESCE(body.endDate, plans.end_date), title/description 等同理
     slot_time = body.localTime ?? SELECT local_time FROM plan_schedule_slots
                 WHERE plan_version_id = current_version AND slot_key = 'default'
     INSERT plan_schedule_slots(plan_version_id=vN+1, slot_key='default', local_time=slot_time)
     -- **每个** plan_version **无条件**创建 slot 快照；localTime 未变则复制旧值
  5. cancelPendingAfterEndDate(student_id, plans.end_date) — §4.8b
  6. cancel future pending（旧 version，family_date >= effective_from）
  7. through = horizonThrough(plans)
  8. from = effective_from
  9. IF from > through → 跳过 generate（0 新实例）
     ELSE generateHorizonInline(plans, version=vN+1, from, through, ignoreCancelled=true)
 10. persistExpiredPastWindow(student_id)
 11. audit + outbox(plan.version_created) — **不含** horizon_maintained
```

（步骤 4：版本与 slot 快照先于 horizon 生成；F27 覆盖 localTime 未变仍建新 slot。）

**禁止**：从「含已取消实例的全表 max(future family_date)」起算；那会导致新版本 0 实例。

### 5.3 停用计划

```text
POST /api/formal-plans/:planId/deactivate
Headers: Idempotency-Key

  1. assert owner
  2. 规范化 body（空对象）→ hash
  3. SELECT plans WHERE id AND deactivate_idempotency_key
     → 命中且 hash 一致: **200 回放** inactive 状态
     → 命中且 hash 不一致: 409
  4. UPDATE plans.status = inactive
  5. future pending → cancelled（所有 version）
  6. persistExpiredPastWindow(student_id)
  7. audit + outbox(plan.deactivated)

不扩展 horizon；不写 schedule_horizon_maintains。
```

### 5.4 完成日程

```text
POST /api/schedule-items/:itemId/complete
Headers: Idempotency-Key

步骤 1–5：§5.0 共用决策
6. kind = deriveCompletionKind(now, item.family_date)
7. INSERT schedule_events (from_status=pending, to_status=completed, actor_id=student, completion_kind=kind, occurred_at=now, bodyHash)
8. UPDATE schedule_items.status = completed
9. INSERT fact_versions (student_id, schedule_item_id, fact_key='schedule.completed',
     source_kind='system', value={ completion_kind: kind }, occurred_at, asserted_at, recorded_at,
     idempotency_key, idempotency_payload_hash=bodyHash, completion_kind=kind)
10. settlementService.settleForFact — §5.5
11. audit + outbox(schedule.completed, points.settled)
```

### 5.4b 跳过日程

```text
POST /api/schedule-items/:itemId/skip
Headers: Idempotency-Key
Body: { reason? }

步骤 1–5：§5.0 共用决策
6. INSERT schedule_events (from_status=pending, to_status=skipped, actor_id, completion_kind=NULL, reason?, bodyHash)
7. UPDATE schedule_items.status = skipped
8. audit + outbox(schedule.skipped) — 无 fact/settlement/ledger

状态竞争：complete 与 skip 互斥；先写入者胜出；后到的异键 → 409；同 key 跨动作 → 409（§5.0 步骤 3）。
```

### 5.5 同步结算（D1 inline）

```text
settleForFact(fact_version_id) — 在 complete 事务内同步调用：

  1. load active point_rule + template（schedule_system_complete_v1）
  2. 读取 fact.completion_kind：
     - on_time 或 late（窗口内迟完成）→ amount = +10（模板 rewardsLateCompletion=true）
     - 窗口外不应到达（complete 已 409）
  3. INSERT settlements (
       student_id, fact_version_id, rule_version_id,
       settlement_period=fact.schedule_item.family_date,
       result='reward', explanation,
       idempotency_key=fact.idempotency_key
     ) ON CONFLICT (fact_version_id, rule_version_id, settlement_period) DO NOTHING
     RETURNING id
     → 若冲突：SELECT 原 settlement（不得重复 INSERT ledger）
  4. INSERT point_ledger_entries (
       student_id, settlement_id, amount=+10,
       reason='schedule_complete', source_type='settlement',
       idempotency_key=fact.idempotency_key,
       explanation 含 completion_kind
     ) ON CONFLICT (settlement_id) DO NOTHING
     RETURNING id
     → **仅当 RETURNING 有新行**：
       INSERT INTO point_balance_projection (student_id, balance, last_ledger_entry_id)
       VALUES (:student_id, :amount, :ledger_id)
       ON CONFLICT (student_id) DO UPDATE
       SET balance = point_balance_projection.balance + EXCLUDED.balance,
           last_ledger_entry_id = EXCLUDED.last_ledger_entry_id,
           updated_at = now()
       -- :amount = +10；projection **无** amount 列；冲突时以 EXCLUDED.balance 累加
     → 若冲突（无 RETURNING）：SELECT 原 ledger 回放；**禁止** UPSERT balance
  5. 不同 schedule_item 复用同一客户端 Idempotency-Key → 各自 settlement/ledger（scope 不同）
  6. 首次 complete → balance 0→+10；同 fact 回放 → balance 不变（F25）

skip 路径不得调用本函数。
```

### 5.6 启用积分规则（D8）

```text
POST /api/family/students/:studentId/point-rules
Headers: Idempotency-Key
Body: { templateId: "schedule_system_complete_v1" }

  1. assert parent + active relationship
  2. 规范化 body → hash
  3. SELECT point_rules WHERE (creator_parent_id, student_id, create_idempotency_key)
     → 命中且 hash 一致: **200 回放** rule
     → 命中且 hash 不一致: 409
  4. INSERT point_rules + point_rule_versions v1
  5. audit + outbox(point_rule.enabled)

与「创建计划」为**独立步骤**；E2E 步骤 3 显式调用。
```

### 5.7 表级幂等（D5）

**不新建** `command_log` / `command_idempotency`。

| 命令 | 权威表 | UNIQUE scope | 回放 | 同 key 异 payload | 跨 actor（schedule_events） | 跨命令同 key |
| --- | --- | --- | --- | --- | --- | --- |
| 创建计划 | `plans` | `(owner_id, student_id, create_idempotency_key)` | 200 原 plan | 409 | — | 允许 |
| 编辑版本 | `plan_versions` | `(plan_id, create_idempotency_key)` | 200 原 version | 409 | — | 允许 |
| 停用 | `plans` | `(id, deactivate_idempotency_key)` | 200 inactive | 409 | — | 允许 |
| 完成 | `schedule_events` | `(schedule_item_id, idempotency_key)` | 200 含 ledger | 409 | **409，不回放** | 允许 |
| 跳过 | `schedule_events` | `(schedule_item_id, idempotency_key)` | 200 skip | 409；与 complete **同 key 409** | **409，不回放** | 允许 |
| 启用规则 | `point_rules` | `(creator_parent_id, student_id, create_idempotency_key)` | 200 原 rule | 409 | — | 允许 |
| 滚动维护 | `schedule_horizon_maintains` | `(student_id, actor_id, idempotency_key)` | 200 原结果 | 409 | actor 在 scope | 允许 |

**创建计划顺序**：必须先幂等查询，**再** active formal plan 检查（F9b）。

### 5.8 Horizon：内联 vs 独立命令（阻断 #6、#7）

#### A. 内联 `generateHorizonInline()`（创建/编辑事务）

| 项 | 行为 |
| --- | --- |
| 写 `schedule_horizon_maintains` | **否** |
| audit/outbox | **仅** plan.created / plan.version_created |
| 幂等键 | **无**（跟随 create/edit 幂等；create **回放时不调用**） |
| horizon | 固定 **30 天**；上界 `horizonThrough(plan) = min(endDate, currentFamilyDate + 30)` |
| 生成范围 | 创建：`max(startDate, today)`→through；编辑：`effective_from`→through（当前 version） |

**`horizonThrough(plan)`**：

```typescript
function horizonThrough(plan: { endDate?: string }, now: Date): string {
  const cap = addFamilyDays(currentFamilyDate(now), 30);
  if (plan.endDate == null) return cap;
  return plan.endDate < cap ? plan.endDate : cap;
}
```

**算法**：

```text
generateHorizonInline(plan, version, from, through, ignoreCancelled):
  for each family_date in [from .. through]:
    if plan.endDate set and family_date > plan.endDate: continue
    occurrence_key = "{plan.id}:{version.id}:{family_date}:daily:{localTime}"
    scheduled_at = toScheduledAt(family_date, localTime, Asia/Shanghai)
    INSERT schedule_items (plan_id, plan_version_id, family_date, scheduled_at, occurrence_key, status=pending)
    ON CONFLICT (occurrence_key) DO NOTHING
  -- ignoreCancelled: 计算 maintain 起点时不得用已 cancelled 行的 max 日期
```

#### B. 独立 `POST /api/family/students/:studentId/formal-plans/maintain-horizon`

```text
POST /api/family/students/:studentId/formal-plans/maintain-horizon
Headers: Idempotency-Key
Body: （空 — 固定 30 天）

Auth: 家长 + relationship

Transaction:
  1. bodyHash = normalizeIdempotencyPayload({})
  2. existing = SELECT schedule_horizon_maintains
                WHERE (student_id, actor_id, idempotency_key)
     IF existing:
       IF existing.idempotency_payload_hash != bodyHash → 409
       ELSE → **200 回放**（**不** generate / audit / outbox）
  3. plan = SELECT plans FOR UPDATE WHERE student_id AND plan_kind='formal' AND status='active'
     assert plan + current plan_version
  4. INSERT schedule_horizon_maintains (student_id, actor_id, key, hash, items_created=0)
     ON CONFLICT (student_id, actor_id, idempotency_key) DO NOTHING
     RETURNING id
     IF 无 RETURNING:
       row = SELECT 既有 maintain WHERE (student_id, actor_id, key)
       IF row.hash != bodyHash → 409
       ELSE → **200 回放** row（**不** generate / audit / outbox）
  5. -- 仅步骤 4 RETURNING 成功者（首个占位）继续：
     persistExpiredPastWindow(student_id)   -- **含 no-op**（items_created=0）；回放路径跳过
     through = horizonThrough(plans)
     IF plans.end_date IS NOT NULL AND currentFamilyDate > plans.end_date:
       items_created = 0
     ELSE:
       from = max( currentVersion pending 最远 family_date+1, currentFamilyDate )
       IF from > through → items_created = 0
       ELSE items_created = generateHorizonInline(plans, version, from, through)
  6. UPDATE schedule_horizon_maintains SET items_created = :n WHERE id = :maintain_id
  7. IF items_created > 0: audit + outbox(schedule.horizon_maintained)
  8. 返回 200 { items_created }
```

**no-op 语义**：`items_created=0` 时仍执行步骤 5 的 `persistExpiredPastWindow`；**不** generate / audit / outbox（F8/F22/F28）。

**并发语义**：同 `(student_id, actor_id, idempotency_key)` 并发请求 → 仅首个占位者 generate/audit/outbox；后到 **200 回放**，0 副作用（F14/F26）。

#### C. UI 触发（阻断 #7）

- **禁止**页面 mount / useEffect 自动 POST。
- 家长计划/日程页提供 **「补齐日程」/「刷新未来日程」** 按钮 → 用户点击才 POST maintain-horizon。
- GET 列表/详情 **永不** 触发维护。

## 6. 完成窗口与过期

**权威定义**（`CONTEXT.md` 迟完成；`docs/data-model.md` §4）：

- 完成窗口：计划 `family_date` 当日至 **`family_date + 1` 家庭自然日结束**（Asia/Shanghai 23:59:59.999）。
- 窗口内迟完成：`completion_kind=late`，模板 `rewardsLateCompletion: true`，**+10**。
- 超过窗口：`effectiveStatus=expired`（只读）；持久化 `expired` 于 complete/skip 尝试或维护事务。

```typescript
// src/modules/time-policy/completion-window.ts
completionWindowEnd(familyDate: string): Date
isWithinCompletionWindow(familyDate: string, now: Date): boolean
isPastCompletionWindow(familyDate: string, now: Date): boolean

// schedule-query.service.ts — 只读，GET 路径
function effectiveStatus(item, now): Status {
  if (item.status !== "pending") return item.status;
  if (isPastCompletionWindow(item.familyDate, now)) return "expired";
  return "pending";
}
```

| 路径 | 写库 | 行为 |
| --- | --- | --- |
| GET 列表/详情 | **否** | 返回 `status` + `effectiveStatus` |
| complete（窗口内 on_time/late） | 是 | completed + fact + **+10 ledger** |
| complete（窗口外） | 是 | persist expired → **409** |
| skip（窗口外） | 是 | persist expired → **409** |
| maintain-horizon / create / edit | 是 | 批量 persistExpiredPastWindow |

**M2 不做**：18:00 补填 cutoff、模板未达标扣分、事实更正（M3+）。

## 6.1 失败路径（HTTP 摘要）

| 场景 | HTTP | 测试 |
| --- | --- | --- |
| 未授权 | 403 | F1 |
| 创建：同 key 同 payload 回放 | 200；**不**触发 active plan 冲突 | F9, F9b, F21 |
| 创建：同 key 异 payload | 409 | F9 |
| 创建：无幂等命中且已有 active plan | 409 | F9b |
| 编辑/停用/启规则 hash 不一致 | 409 | F10 |
| 停用后 future pending→cancelled | 200 inactive | F2 |
| 编辑后 effective_from 有新实例 | 200 | F19 |
| create 回放无二次 horizon/outbox | 200 | F21 |
| 结算同键回放 | 200；余额不变 | F4 |
| 维护 batch persist expired | 写 expired | F8 |
| 已完成异键 complete | 409 | F3 |
| complete 同键回放 | 200 含 ledger | F11 |
| 窗口外 complete/skip | persist expired + 409 | F7, F18 |
| 窗口内 late complete | 200；+10 | F15 |
| 同 item 同 key 异 actor | 409 | F20 |
| complete/skip 同 key | 409 | F16 |
| skip 无 ledger | 200 skip | F17 |
| GET 列表多次 | 200，零 UPDATE | F5 |
| effective expired 只读 | GET 返回 expired | F6 |
| maintain 同键回放 | 200；无 generate/audit/outbox | F14 |
| maintain 并发同 scope+key | 仅 1 generate/audit/outbox | F26 |
| maintain mount/GET 触发 | **禁止** | F14, NF-7 |
| 编辑 localTime 未变 | 仍建 slot 快照 + 生成实例 | F27 |
| 同 key 不同 student 创建 | 各自 200 | F12 |
| 跨命令类型同 key | 允许 | F13 |
| endDate 上界 min(endDate, today+30) | 200；实例不超出 endDate | F22 |
| 缩短 endDate 取消 future pending | 200；§4.8b | F22 |
| maintain 计划已结束 / from>through | 200 no-op；persist expired；**无** horizon_maintained outbox | F22/F28 |
| 缺 Idempotency-Key（七类写 Route） | **400** `IDEMPOTENCY_KEY_REQUIRED` | F23 |
| complete/skip 并发同 key | 200 回放；仅 1 event/fact/ledger | F24 |
| ledger 首次写入 balance +10 | 200 | F25 |
| ledger 冲突 / 跨 item 同客户端 key | 各自记账；回放 balance 不变 | F25 |

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

### 7.1 写 Route HTTP 契约（C8）

**七类写 Route**（创建/编辑/停用计划、maintain-horizon、complete、skip、启规则）均 **强制** `Idempotency-Key` 请求头（非空字符串）。

| 条件 | HTTP | 错误码 |
| --- | --- | --- |
| 缺失或空白 `Idempotency-Key` | **400** | `IDEMPOTENCY_KEY_REQUIRED` |
| 鉴权失败 | 403 | （M1 既有） |
| 幂等冲突（异 payload/actor/终态） | 409 | 命令级稳定码 |

Route Handler 在鉴权前校验 header；不得进入 domain 层。响应体 `{ error: { code, message } }` 与 M1 API 风格一致。

## 8. Time Policy（`src/modules/time-policy/`）

`to-family-date.ts`, `resolve-age-band.ts`, `to-scheduled-at.ts`, `next-family-date.ts`, `family-date-range.ts`, `add-family-days.ts`, `horizon-through.ts`, `completion-window.ts`, `derive-completion-kind.ts`

`horizon-through.ts` 导出 `horizonThrough(plan, now)` — §5.8A 唯一实现源；**禁止**在 Route/Service 重复计算上界。

## 9. 已批准决策

| # | 决策 | 内容 |
| --- | --- | --- |
| D1 | 结算 | inline 同事务 fact→settlement→ledger→balance→audit→outbox |
| D2 | 积分 | +10/次；late 同 on_time（`rewardsLateCompletion: true`） |
| D3 | Horizon | 固定 30 天；内联 + 显式 maintain 按钮 |
| D4 | 过期 | GET 只读 effectiveStatus；persist 仅写事务 |
| D5 | 幂等 | 表级 key+hash；无 command_log |
| D6 | Skip | 仅 API + 集成测试 |
| D7 | Goal | M2 不绑 goal |
| D8 | 启规则 | 独立步骤（E2E 步骤 3） |

## 10. 测试策略与 AC 映射

| 层级 | 范围 | 入口 |
| --- | --- | --- |
| 单元 | time-policy 窗口/kind；occurrence_key；effectiveStatus | `tests/unit/time-policy/` |
| 集成 | 七类写命令幂等、horizon、complete/skip、settlement、outbox | `tests/integration/schedule/`、`settlement/` |
| E2E | desktop-chromium + mobile-360 各完整 7 步 | `tests/e2e/m2-schedule-points-flow.spec.ts` |
| 静态 | test、typecheck、lint、format、build | `pnpm test && pnpm typecheck && …` |
| 回归 | M1 53 Vitest + 10 E2E | 全量 CI |

| AC/F | 测试文件 |
| --- | --- |
| AC-M2-1, F8, F9, F9b, F19, F21, F27 | `formal-plan.test.ts` |
| AC-M2-2 | `schedule-generation.test.ts` |
| AC-M2-3, F3, F7, F11, F15, F20 | `schedule-complete.test.ts` |
| AC-M2-4, AC-M2-5, F4, F15 | `settlement-ledger.test.ts` |
| AC-M2-6 | `formal-plan.test.ts` (F19) |
| AC-M2-7 | `m2-schedule-points-flow.spec.ts` |
| AC-M2-8, F21 | `schedule-outbox.test.ts` |
| F1 | `schedule-auth.test.ts` |
| F2 | `formal-plan.test.ts` |
| F5, F6 | `schedule-query.test.ts` + unit effective-status |
| F14, F26, F28 | `maintain-horizon.test.ts` |
| F16–F18, F20, F24 | `schedule-skip.test.ts` |
| F9–F13, F20 | `command-idempotency.test.ts` |
| F22, F28 | `plan-end-date.test.ts` |
| F23 | `write-route-idempotency-header.test.ts` |
| F24 | `schedule-terminal-concurrency.test.ts` |
| F25 | `settlement-ledger.test.ts` |
| F27 | `formal-plan.test.ts` |
| F1–F21, F22–F28 | 见上表及 `m2-verification-matrix.md` §3 |

## 11. Web UI（M2）

| 路径 | 角色 | 行为 |
| --- | --- | --- |
| `/parent/students/[id]/plan` | 家长 | 计划 CRUD；**「补齐日程」按钮** → POST maintain-horizon；**禁止** mount 自动 POST |
| `/student/schedule` | 学生 | 日程列表；完成按钮 → POST complete |
| 首页/积分卡片 | 双方 | 展示余额与今日 20:00 任务（可嵌入现有 shell） |

Skip **无 UI**。360×800 无横向滚动（NF-2）。

## 12. 规划复审

审阅入口：`PLANNING-REVIEW.md`；逐项清单：`research/planning-signoff-checklist.md`。
