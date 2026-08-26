# M2 技术设计 — 计划与固定积分闭环

## 1. 设计原则

- **Module Interface 优先**：Schedule & Facts、Settlement & Ledger 通过命令/查询 Interface 暴露；Route Handler 仅做 HTTP 适配、鉴权与 DTO 校验。
- **权威事实在 PostgreSQL**：计划版本、日程实例、事实版本、结算、流水为事实源；余额为投影。
- **Time Policy 单点**：所有 `family_date`、计划本地时间、完成/过期窗口、`scheduled_at` UTC 换算仅由 **`src/modules/time-policy/`**（扩展现有 M1 模块）计算；**禁止**新建并行 `src/modules/time/`；禁止在 Route/Component 散落时区逻辑。
- **M2 同步边界**：outbox 随事务写入，状态 `pending`；**不**启动 Worker/cron；结算在「完成日程」命令事务内同步执行。
- **最小闭环**：M2 不引入个人计划、人工事实、冲销、Worker、兑换。

## 2. 领域边界

（结构图同前版，略）

### 边界规则

| 实体 | 谁可写 | 谁可读 | 不变量 |
| --- | --- | --- | --- |
| `plans` | 计划 owner（家长） | 关联家长、学生 | 每学生 ≤1 active formal |
| `plan_versions` | 系统随计划命令追加 | 同上 | 只追加；`effective_from` ≥ 编辑日+1 |
| `schedule_items` | Schedule Module | 关联家长、学生 | `occurrence_key` UNIQUE；状态机单向 |
| `fact_versions` | Schedule Module（完成命令） | 关联家长、学生 | 只追加；含 `idempotency_key`；更正不在 M2 |
| `schedule_horizon_maintains` | 维护命令 | — | 滚动生成幂等锚点 |
| `point_rule_templates` | 管理员 seed | 家长读、学生只读 | M2 一条固定模板 |
| `point_rules` | 家长 creator | 同上 | 绑定 `student_id` |
| `settlements` | Settlement Module | 同上 | 一事实一周期一规则版本最多一条 |
| `point_ledger_entries` | Settlement Module | 同上 | 无 UPDATE/DELETE |
| `point_balance_projection` | Settlement Module（同事务） | 同上 | 必须可由 ledger 重建 |

## 3. 逻辑架构

```text
Browser (React — 计划表单、日程列表、完成按钮、积分展示)
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

### Module 职责（M2 子集）

| Module | 命令 | 查询 | 禁止 |
| --- | --- | --- | --- |
| Schedule | 计划 CRUD；**maintain-horizon**；完成/跳过 | 计划、日程列表（**只读**） | GET 写库；ledger 直写 |
| Settlement | 启用规则；inline 结算 | 余额、流水 | 覆盖 fact/ledger |
| Time Policy | （纯函数）family_date、窗口、scheduled_at | — | 散落时区逻辑 |
| Family Access | — | 授权校验 | — |
| Audit / Outbox | append | — | 先 commit 再 outbox |

## 4. 数据模型（M2 表）

```
plans, plan_versions, plan_schedule_slots
schedule_items, schedule_events
schedule_horizon_maintains          ← 滚动维护幂等（D3）
fact_versions
point_rule_templates, point_rules, point_rule_versions
settlements, point_ledger_entries, point_balance_projection
audit_events, outbox_events (已有)
```

M2 **不含** `goals`（D7）。

### 关键字段与约束

| 表 | 字段（幂等） | 约束 |
| --- | --- | --- |
| `plans` | `create_idempotency_key`, `create_idempotency_payload_hash` | UNIQUE `(owner_id, student_id, create_idempotency_key)` |
| `plans` | `deactivate_idempotency_key`, `deactivate_idempotency_payload_hash` | UNIQUE `(id, deactivate_idempotency_key)` |
| `plan_versions` | `create_idempotency_key`, `create_idempotency_payload_hash` | UNIQUE `(plan_id, create_idempotency_key)` |
| `schedule_events` | `event_type`, `idempotency_key`, `idempotency_payload_hash`, `actor_id` | UNIQUE `(schedule_item_id, idempotency_key)` **不含 event_type** → 同 item 同 key 跨 complete/skip **409** |
| `fact_versions` | `idempotency_key`, `idempotency_payload_hash` | UNIQUE `(schedule_item_id, idempotency_key)`；与完成 event 对齐 |
| `schedule_horizon_maintains` | `idempotency_key`, `idempotency_payload_hash`, `actor_id` | UNIQUE `(student_id, actor_id, idempotency_key)` |
| `point_rules` | `create_idempotency_key`, `create_idempotency_payload_hash` | UNIQUE `(creator_parent_id, student_id, create_idempotency_key)` |
| `schedule_items` | — | `occurrence_key` UNIQUE |
| `settlements` / `point_ledger_entries` | 派生键 | 见 §5.5 |

**payload hash**：对各命令请求体做**规范化 JSON**（稳定键序、剔除 idempotency 元字段）后 SHA-256，存 `idempotency_payload_hash`（text hex）。同 scope+key：hash 一致 → 回放；不一致 → 409。

**actor 与 scope**：`owner_id` / `creator_parent_id` / `actor_id` 均为 scope 组成部分（UNIQUE 列含 actor 或资源天然绑定 actor，如 `plan_versions.plan_id` 仅 owner 可写）。

## 5. 写命令设计

### 5.1 创建正式计划

```text
POST /api/family/students/:studentId/formal-plans
Headers: Idempotency-Key
Body: { title, description?, localTime: "20:00", startDate, endDate? }

顺序（事务内，强制）:
  1. assert parent verified + active relationship + student scope
  2. 规范化 body → idempotency_payload_hash
  3. SELECT plans WHERE (owner_id, student_id, create_idempotency_key)
     → 命中且 hash 一致: **200 回放**原 plan（跳过步骤 4–7）
     → 命中且 hash 不一致: **409**
  4. **仅未命中幂等时**：assert 无其他 active formal plan（否则 409）
  5. INSERT plans + plan_versions v1
  6. maintainScheduleHorizon(student, horizonDays=30) — 见 §5.8
  7. audit + outbox(plan.created)
```

### 5.2 编辑计划（新版本）

```text
PATCH /api/formal-plans/:planId
Headers: Idempotency-Key

  1. assert owner
  2. 幂等查 plan_versions (plan_id, key) → 回放/409
  3. INSERT plan_versions vN+1, effective_from = nextFamilyDate(now)
  4. cancel future pending（version 旧且 family_date >= effective_from）
  5. maintainScheduleHorizon（同事务）
  6. audit + outbox
```

### 5.3 停用计划

```text
POST /api/formal-plans/:planId/deactivate
Headers: Idempotency-Key

  1. assert owner
  2. 幂等查 plans.deactivate_idempotency_key → 回放/409
  3. status = inactive；future pending → cancelled
  4. persistExpiredPastWindow（维护事务内，见 §过期）
  5. audit + outbox
```

### 5.4 完成日程

```text
POST /api/schedule-items/:itemId/complete
Headers: Idempotency-Key

  1. assert student owns item
  2. 幂等查 schedule_events (schedule_item_id, key)
     → 若已有 event_type=complete 且 hash 一致: **200 回放**（含 fact/settlement）
     → 若已有 event（任意 type）且 hash 不一致: **409**
     → 若已有 skip 等同 key: **409**（跨动作冲突）
  3. 若 pending 且 **已过完成窗口**（§过期）: persist expired → **409**
  4. 若 pending 且在窗口内（含**迟完成**）: 继续
  5. INSERT schedule_events (event_type=complete, actor_id=student)
  6. UPDATE schedule_items.status = completed（迟完成标记 completion_kind=late 可选字段或 schedule_events metadata）
  7. INSERT fact_versions（含 idempotency_key + hash，与 event 一致）
  8. settlementService.settleForFact — §5.5（迟完成仍 +10，见模板）
  9. audit + outbox
```

### 5.4b 跳过日程（D6，仅 API + 集成测试）

```text
POST /api/schedule-items/:itemId/skip
Headers: Idempotency-Key
Body: { reason? }   // 可选

  1. assert actor = 关联学生本人 **或** 已关联家长
  2. 幂等查 schedule_events (schedule_item_id, key) — 规则同 §5.4（跨 complete/skip 同 key → 409）
  3. 若 status 非 pending: 同键回放 skip event / 异键 409
  4. INSERT schedule_events (event_type=skip, actor_id, reason?)
  5. UPDATE schedule_items.status = skipped
  6. **无** fact_versions、settlement、ledger
  7. audit + outbox(schedule.skipped)

状态竞争：complete 与 skip 互斥；先完成者胜出；后到的异键请求 409；同键跨动作 409。
```

### 5.5 同步结算（D1 inline）

```text
settleForFact(fact_version_id):
  1. load active point_rule + template（schedule_system_complete_v1）
  2. 评估 completion_kind：
     - on_time 或 late（窗口内迟完成）→ amount = +10（模板 rewardsLateCompletion=true）
     - 窗口外不应到达（complete 已 409）
  3. INSERT settlements ... ON CONFLICT DO NOTHING
  4. INSERT point_ledger_entries (+10, explanation 含 late/on_time)
  5. UPSERT point_balance_projection
```

### 5.6 启用积分规则（D8）

```text
POST /api/family/students/:studentId/point-rules
Headers: Idempotency-Key
Body: { templateId }

  1. assert parent + relationship
  2. 幂等查 point_rules (creator_parent_id, student_id, key) → 回放/409
  3. INSERT point_rules + point_rule_versions v1
  4. audit + outbox
```

### 5.7 表级幂等（D5）

**不新增** `command_log` / `command_idempotency`。

| 命令 | 权威表 | UNIQUE scope | 回放 | 同 key 异 payload | 跨命令同 key |
| --- | --- | --- | --- | --- | --- |
| 创建计划 | `plans` | `(owner_id, student_id, key)` | 200 原 plan | 409 | 允许（不同表） |
| 编辑版本 | `plan_versions` | `(plan_id, key)` | 200 原 version | 409 | 允许 |
| 停用 | `plans` | `(id, deactivate_key)` | 200 inactive | 409 | 允许 |
| 完成 | `schedule_events` | `(schedule_item_id, key)` | 200 含 ledger | 409 | 允许 |
| 跳过 | `schedule_events` | `(schedule_item_id, key)` | 200 skip | 409；与 complete **同 key 409** | 允许 |
| 启用规则 | `point_rules` | `(creator_parent_id, student_id, key)` | 200 原 rule | 409 | 允许 |
| 滚动维护 | `schedule_horizon_maintains` | `(student_id, actor_id, key)` | 200 原结果 | 409 | 允许 |

**创建计划顺序**：必须先步骤 3 幂等查询，**再**步骤 4 active plan 检查（审阅意见 #1）。

### 5.8 滚动生成 / 维护命令（D3）

**决策**：D3「30 天滚动」采用**显式维护命令**（非 GET 隐式触发；无 Worker/cron）。

```text
POST /api/family/students/:studentId/formal-plans/maintain-horizon
Headers: Idempotency-Key
Body: { horizonDays?: 30 }   // 默认 30，M2 不允许客户端超过 30

Auth: 已验证家长 + active relationship（**仅家长**；学生不可调用）

Transaction:
  1. 幂等查 schedule_horizon_maintains (student_id, actor_id=parent, key)
  2. assert 存在 active formal plan
  3. horizon_through = currentFamilyDate + horizonDays
  4. 从 max(已有 future family_date, currentFamilyDate) 起生成至 horizon_through
     — INSERT schedule_items ON CONFLICT (occurrence_key) DO NOTHING
  5. persistExpiredPastWindow(student_id) — 窗口外 pending → expired
  6. INSERT schedule_horizon_maintains 记录
  7. audit + outbox(schedule.horizon_maintained)
```

**调用时机（均非 GET）**：

| 调用者 | 时机 |
| --- | --- |
| 创建/编辑计划事务 | 步骤 6 / 5 内联调用同一 `maintainScheduleHorizon()` |
| 家长计划/日程页 Client | mount 或显式刷新按钮发起 **POST maintain-horizon**（Route Handler 仅转发至 service，**GET 不得调用**） |
| 停用计划 | 不扩展 horizon；仅 persistExpired |

**扩展 horizon**：每次维护将「已生成最远 family_date」推进到 `today+30`；重复 POST 同键回放；重复 POST 异键幂等扩展（ON CONFLICT DO NOTHING）。

## 6. 完成窗口、迟完成与过期（对齐 CONTEXT / data-model）

**权威定义**（`CONTEXT.md` 迟完成；`docs/data-model.md` §4）：

- 完成窗口：计划 `family_date` 当日至 **`family_date + 1` 家庭自然日结束**（Asia/Shanghai 23:59:59.999）。
- 窗口内完成（含**迟完成**）：允许；M2 固定模板 **`rewardsLateCompletion: true`**，仍 **+10**（与按时完成相同）；`completion_kind` 区分 `on_time` / `late` 写入 event/fact metadata。
- **超过窗口**：`effectiveStatus=expired`（只读）；持久化 `expired` 仅于完成尝试（409）或维护命令事务。

```typescript
// src/modules/time-policy/completion-window.ts（扩展）
completionWindowEnd(familyDate: string): Date  // family_date+1 日结束 UTC instant
isWithinCompletionWindow(familyDate: string, now: Date): boolean
isPastCompletionWindow(familyDate: string, now: Date): boolean

// schedule-query.service.ts — 只读
function effectiveStatus(item, now): Status {
  if (item.status !== "pending") return item.status;
  if (isPastCompletionWindow(item.familyDate, now)) return "expired";
  return "pending";
}
```

| 路径 | 写库 | 行为 |
| --- | --- | --- |
| GET 列表/详情 | **否** | 返回 `status` + `effectiveStatus` |
| complete（窗口内 late） | 是 | completed + fact + **+10 ledger** |
| complete（窗口外） | 是 | persist expired → 409 |
| maintain-horizon / create / edit | 是 | 批量 persistExpiredPastWindow |

**M2 不做**：18:00 补填 cutoff、模板未达标扣分、事实更正（M3+）。

## 7. 失败路径（摘要）

| 场景 | HTTP |
| --- | --- |
| 创建：同 key 回放 | 200（**不**触发 active plan 冲突） |
| 创建：异 payload 同 key | 409 |
| 创建：无幂等命中且已有 active plan | 409 |
| complete vs skip 同 item 同 key | 409 |
| skip 已完成 item（异键） | 409 |
| GET 多次 | 无 UPDATE |
| 窗口外 complete | persist expired + 409 |

## 8. API 清单

| 方法 | 路径 | 角色 |
| --- | --- | --- |
| POST | `/api/family/students/[id]/formal-plans` | 家长 |
| POST | `/api/family/students/[id]/formal-plans/maintain-horizon` | 家长 |
| GET | `/api/family/students/[id]/formal-plans/current` | 家长、学生 |
| PATCH | `/api/formal-plans/[planId]` | 家长 owner |
| POST | `/api/formal-plans/[planId]/deactivate` | 家长 owner |
| GET | `/api/family/students/[id]/schedule-items?from&to` | 家长、学生（只读） |
| POST | `/api/schedule-items/[itemId]/complete` | 学生 |
| POST | `/api/schedule-items/[itemId]/skip` | 学生、关联家长 |
| POST | `/api/family/students/[id]/point-rules` | 家长 |
| GET | `/api/family/students/[id]/points/balance` | 家长、学生 |
| GET | `/api/family/students/[id]/points/ledger?limit` | 家长、学生 |

## 9. Time Policy 扩展（`src/modules/time-policy/`）

| 文件 | 职责 |
| --- | --- |
| `to-family-date.ts` | 已有 |
| `resolve-age-band.ts` | 已有 |
| `to-scheduled-at.ts` | family_date + localTime → UTC |
| `next-family-date.ts` | 编辑生效日 |
| `family-date-range.ts` | horizon 日期枚举 |
| `completion-window.ts` | 迟完成/过期窗口 |

测试：`tests/unit/time-policy/*.test.ts`

## 10. 已批准决策（2026-08-26，审阅修订）

| # | 决策 | 值 |
| --- | --- | --- |
| D1 | inline 结算 | 同事务 |
| D2 | 固定模板 | +10/次；**含迟完成**（窗口内） |
| D3 | 30 天滚动 | **显式 maintain-horizon 命令** + 创建/编辑内联；GET 不触发 |
| D4 | 过期 | GET 只读 effective；持久化仅完成尝试/维护事务；**对齐次日结束窗口** |
| D5 | 幂等 | 表级 key + payload hash；complete/skip 同 item 同 key 冲突 409 |
| D6 | skip | API + 集成测试；无 UI/E2E |
| D7 | goal | 不绑 |
| D8 | 启规则 | 独立步骤 |

## 11. 测试策略

- 单元：`time-policy/completion-window`、occurrence_key、effectiveStatus
- 集成：幂等顺序、maintain-horizon、skip、迟完成 +10、跨动作 key 冲突
- E2E：**desktop-chromium 与 mobile-360 各跑完整链路**（建计划→启规则→完成→+10→刷新/重登/重复提交）

## 12. 回滚与迁移

见 `implement.md`。
