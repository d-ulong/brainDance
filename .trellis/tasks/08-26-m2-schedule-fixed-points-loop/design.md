# M2 技术设计 — 计划与固定积分闭环

## 1. 设计原则

- **Module Interface 优先**：Schedule & Facts、Settlement & Ledger 通过命令/查询 Interface 暴露；Route Handler 仅做 HTTP 适配、鉴权与 DTO 校验。
- **权威事实在 PostgreSQL**：计划版本、日程实例、事实版本、结算、流水为事实源；余额为投影。
- **Time Policy 单点**：所有 `family_date`、计划本地时间、`scheduled_at` UTC 换算、业务日边界仅由 `src/modules/time/`（或等价）计算；禁止在 Route/Component 散落时区逻辑。
- **M2 同步边界**：outbox 随事务写入，状态 `pending`；**不**启动 Worker；结算在「完成日程」命令事务内同步执行。
- **最小闭环**：M2 不引入个人计划、人工事实、冲销、Worker、兑换。

## 2. 领域边界

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Formal Plan    │────▶│  Plan Version    │────▶│  Schedule Instance  │
│  (plans)        │     │  (plan_versions) │     │  (schedule_items)   │
│  owner, student │     │  schedule_rule   │     │  occurrence_key     │
│  status         │     │  effective_from  │     │  status, snapshot   │
└─────────────────┘     └──────────────────┘     └──────────┬──────────┘
                                                            │
                                                            ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Point Template │────▶│  Point Rule      │     │  Completion Fact    │
│  (admin seed)   │     │  (per student)   │     │  (fact_versions)    │
└─────────────────┘     └────────┬─────────┘     └──────────┬──────────┘
                                 │                            │
                                 ▼                            ▼
                        ┌────────────────────────────────────────────┐
                        │  Settlement (settlements)                  │
                        │  unique (fact, rule_version, period)         │
                        └────────────────────┬───────────────────────┘
                                             ▼
                        ┌────────────────────────────────────────────┐
                        │  Ledger Entry (point_ledger_entries)         │
                        │  append-only, explanation, idempotency     │
                        └────────────────────┬───────────────────────┘
                                             ▼
                        ┌────────────────────────────────────────────┐
                        │  Balance Projection (point_balance_projection)│
                        │  derived; rebuildable from ledger            │
                        └────────────────────────────────────────────┘
```

### 边界规则

| 实体 | 谁可写 | 谁可读 | 不变量 |
| --- | --- | --- | --- |
| `plans` | 计划 owner（家长） | 关联家长、学生（只读配置） | 每学生 ≤1 active formal |
| `plan_versions` | 系统随计划命令追加 | 同上 | 只追加；`effective_from` ≥ 编辑日+1 |
| `schedule_items` | Schedule Module | 关联家长、学生 | `occurrence_key` UNIQUE；状态机单向 |
| `fact_versions` | Schedule Module（完成命令） | 关联家长、学生 | 只追加；更正不在 M2 |
| `point_rule_templates` | 管理员 seed/API | 家长读、学生只读 | M2 一条固定模板 |
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
            ├─ schedule/          ← 新建
            ├─ settlement/        ← 新建
            ├─ time/              ← 新建或 lib/time-policy.ts
            ├─ identity/          ← 只读依赖
            ├─ family-access/     ← 授权校验
            ├─ audit/
            └─ outbox/            ← 复用 appendOutboxEvent
                 └─ PostgreSQL (Drizzle)
```

### Module 职责（M2 子集）

| Module | 命令 | 查询 | 禁止 |
| --- | --- | --- | --- |
| Schedule | 创建/编辑/停用计划；生成实例；完成/跳过日程 | 计划详情、日程列表（按 family_date，**只读**） | 直接写 ledger；**GET 写库**；绕过 relationship 授权 |
| Settlement | 启用规则；评估事实；写 settlement/ledger/余额 | 余额、流水列表、结算解释 | 覆盖 fact/settlement/ledger |
| Time | （纯函数）family_date、scheduled_at、effective_from | — | 散落时区计算 |
| Family Access | — | `assertParentCanAccessStudent` 等 | — |
| Audit / Outbox | append | — | 先 commit 再写 outbox |

## 4. 数据模型（M2 表）

与 `docs/data-model.md` 对齐的 M2 子集（**首次迁移 expand-only**）：

```
plans, plan_versions, plan_schedule_slots
schedule_items, schedule_events
fact_versions
point_rule_templates, point_rules, point_rule_versions
settlements, point_ledger_entries, point_balance_projection
audit_events, outbox_events (已有)
```

M2 **不含** `goals` 表（D7：正式计划不绑定 goal）。

### 关键字段与约束

| 表 | 约束 | 用途 |
| --- | --- | --- |
| `plans` | `(student_id) WHERE plan_kind='formal' AND status='active'` 部分唯一 | 单活跃正式计划 |
| `plans` | `(owner_id, student_id, create_idempotency_key)` UNIQUE WHERE key NOT NULL | 创建计划幂等 |
| `plans` | `(id, deactivate_idempotency_key)` UNIQUE WHERE key NOT NULL | 停用幂等 |
| `plan_versions` | `(plan_id, version)` UNIQUE | 版本单调递增 |
| `plan_versions` | `(plan_id, create_idempotency_key)` UNIQUE WHERE key NOT NULL | 编辑/version 幂等 |
| `plan_schedule_slots` | `(plan_version_id, slot_key)` UNIQUE | M2 仅 `default` 单槽 |
| `schedule_items` | `occurrence_key` UNIQUE | 防重复实例 |
| `schedule_events` | `(schedule_item_id, idempotency_key)` UNIQUE | 完成/跳过幂等 |
| `fact_versions` | `(schedule_item_id, fact_key, version)` UNIQUE | 事实版本链 |
| `point_rules` | `(student_id) WHERE active` 部分唯一（M2 简化） | 单 active 规则 |
| `point_rules` | `(creator_parent_id, student_id, create_idempotency_key)` UNIQUE WHERE key NOT NULL | 启用规则幂等 |
| `settlements` | `(fact_version_id, rule_version_id, settlement_period)` UNIQUE | 防重复结算 |
| `point_ledger_entries` | `idempotency_key` UNIQUE；`settlement_id` UNIQUE nullable | 防重复流水 |
| `point_balance_projection` | `student_id` PK | 每学生一行 |

### occurrence_key 格式（冻结）

```
occurrence_key = "{plan_id}:{plan_version_id}:{family_date}:{slot_key}"
```

- `family_date`：`YYYY-MM-DD`（Asia/Shanghai 日历日）
- `slot_key`：M2 固定 `default`
- 手动日程（M2 不做）使用独立前缀 `manual:{uuid}`

### settlement_period（M2）

对「日程完成」类事件，`settlement_period = schedule_item_id`（实例级唯一结算，避免同日多规则重复——M2 仅一条规则）。

### 过期语义（D4，已批准）

**业务过期窗口（M2 简化）**：`family_date < currentFamilyDate(Asia/Shanghai)` 且库内 `status=pending` 的实例，视为已过期。

| 路径 | 是否写库 | 行为 |
| --- | --- | --- |
| **GET 列表/详情** | **否** | 返回 `status`（持久化值）+ `effectiveStatus`（计算值）；若 pending 且已逾窗口则 `effectiveStatus=expired` |
| **学生完成命令** | **是**（条件） | 若 pending 且已逾窗口：同事务 `UPDATE status=expired` → 拒绝完成 **409**；无 fact/settlement |
| **维护命令事务** | **是** | 创建计划、编辑版本、停用、滚动生成时：对 `family_date < currentFamilyDate` 的 pending 批量 `UPDATE expired` |

**禁止**：任何 SELECT/list handler 内的 UPDATE/INSERT；过期 cron/Worker（M3）。

```typescript
// 只读 — schedule-query.service.ts
function effectiveStatus(item: ScheduleItem, now: Date): ScheduleStatus {
  if (item.status !== "pending") return item.status;
  if (item.familyDate < toFamilyDate(now)) return "expired";
  return "pending";
}
```

## 5. 写命令设计

### 5.1 创建正式计划

```text
POST /api/family/students/:studentId/formal-plans
Headers: Idempotency-Key
Body: { title, description?, localTime: "20:00", startDate, endDate? }

Transaction:
  1. assert parent verified + active relationship + student scope
  2. assert no other active formal plan for student
  3. INSERT plans (formal, active, owner_id=parent)
  4. INSERT plan_versions v1 (schedule_rule: daily, slots: [default@20:00])
  5. generateScheduleInstances(plan, version, horizon=30d) — INSERT ... ON CONFLICT DO NOTHING
  6. expirePastPendingItems(student_id) — 批量 pending→expired（family_date < today）
  7. audit + outbox(plan.created)
```

**幂等**：见 §5.7「创建正式计划」。

### 5.2 编辑计划（新版本）

```text
PATCH /api/formal-plans/:planId
Headers: Idempotency-Key
Body: { localTime?, title?, ... }

Transaction:
  1. assert owner
  2. INSERT plan_versions vN+1, effective_from = nextFamilyDate(now)
  3. UPDATE plans.current_version pointer
  4. cancel future pending items where plan_version < vN+1 AND family_date >= effective_from
  5. regenerate future instances for vN+1
  6. expirePastPendingItems(plan.student_id)
  7. audit + outbox(plan.version_created)
```

**幂等**：见 §5.7「编辑计划版本」。

### 5.3 停用计划

```text
POST /api/formal-plans/:planId/deactivate
Headers: Idempotency-Key

Transaction:
  1. plans.status = inactive
  2. future pending → cancelled
  3. expirePastPendingItems(plan.student_id)
  4. audit + outbox(plan.deactivated)
```

**幂等**：见 §5.7「停用计划」。

**不变量**：`family_date < effective_from` 的实例不修改；已完成/已跳过保留。

### 5.4 完成日程

```text
POST /api/schedule-items/:itemId/complete
Headers: Idempotency-Key

Transaction:
  1. assert student owns schedule_item.student_id
  2. if pending && pastExpiryWindow → UPDATE expired → 409
  3. if status != pending → replay (同键) or 409 (异键)
  4. INSERT schedule_events (→ completed)
  5. UPDATE schedule_items.status = completed
  6. INSERT fact_versions (schedule.completed_at, occurred_at=now)
  7. settlementService.settleForFact(fact) — 见 5.5（D1 inline 同事务）
  8. audit + outbox(schedule.completed, points.settled)
```

**幂等**：见 §5.7「完成日程」。

### 5.5 同步结算（M2 内联）

```text
settleForFact(fact_version_id):  // 仅在 complete 事务内调用（D1）
  1. load active point_rule + rule_version for student
  2. if no rule → skip settlement (M2 测试须启用规则)
  3. INSERT settlements ... ON CONFLICT DO NOTHING
  4. INSERT point_ledger_entries (+10, reason, settlement_id, idempotency_key)
  5. UPSERT point_balance_projection (balance += amount, last_ledger_entry_id)
```

**派生幂等键**（无独立 HTTP 命令）：
- settlement：`settle:{fact_version_id}:{rule_version_id}:{schedule_item_id}`
- ledger：`ledger:{settlement_id}`（与 settlement 1:1）

### 5.6 启用积分规则（D8 独立步骤）

```text
POST /api/family/students/:studentId/point-rules
Headers: Idempotency-Key
Body: { templateId }  // M2 固定 template schedule_system_complete_v1，+10 分

Transaction:
  INSERT point_rules + point_rule_versions v1
  audit + outbox(point_rule.enabled)
```

**幂等**：见 §5.7「启用积分规则」。

### 5.7 表级幂等（D5，已批准）

**不新增** `command_log` / `command_idempotency` 泛化表。复用 M1 模式：权威表上的 `idempotency_key` 字段 + `(actor, scope)` UNIQUE + 先查后写/ON CONFLICT 回放。

| 命令 | 权威表 | 字段 | DB UNIQUE（scope） | 同 scope 同键重放 | 同 scope 同键异 payload | 同键不同 scope |
| --- | --- | --- | --- | --- | --- | --- |
| 创建正式计划 | `plans` | `create_idempotency_key` | `(owner_id, student_id, key)` | **200** 返回原 plan | **409** | 不同 `student_id` **各自成功** |
| 编辑计划版本 | `plan_versions` | `create_idempotency_key` | `(plan_id, key)` | **200** 返回原 version | **409** | 不同 `plan_id` **各自成功** |
| 停用计划 | `plans` | `deactivate_idempotency_key` | `(id, key)` | **200** 已 inactive | **409** | 不同 plan **各自成功** |
| 完成日程 | `schedule_events` | `idempotency_key` | `(schedule_item_id, key)` | **200** 返回原完成+ledger | **409** | 不同 item **各自成功** |
| 启用积分规则 | `point_rules` | `create_idempotency_key` | `(creator_parent_id, student_id, key)` | **200** 返回原 rule | **409** | 不同 student **各自成功** |

**跨命令类型**：同一 key 字符串用于不同命令（如 create-plan 与 enable-rule）→ **允许**（各表 scope 独立，无全局 registry）。客户端仍应每请求生成 UUID。

**实现模式**（对齐 M1 `trainingSessions` / `relationshipRequests`）：

1. 事务开始前 `SELECT` 按 scope+key 查已有行
2. 若存在且 payload 一致 → 返回已有结果
3. 若存在且 payload 不一致 → 409
4. `INSERT ... ON CONFLICT DO NOTHING` + race 后重查

跳过日程（D6）：`POST .../skip`，幂等同 `schedule_events`，`(schedule_item_id, idempotency_key)`；**无 E2E UI**。

## 6. 失败路径

| 场景 | 行为 | HTTP |
| --- | --- | --- |
| 非 owner 编辑计划 | 拒绝 | 403 |
| 第二份 active 正式计划 | 拒绝 | 409 |
| 重复 occurrence 生成 | ON CONFLICT DO NOTHING | 静默成功 |
| 已完成日程再次完成（异键） | 无新 fact/settlement | 409 |
| 同键重试完成 | 回放 item + ledger | 200 |
| 逾期日程完成尝试 | 持久化 expired → 拒绝 | 409 |
| GET 列表多次读取 | 无 UPDATE | — |
| 列表 effective expired | 库 pending，响应 expired | 200 |
| 计划停用后完成旧 pending | 拒绝 | 409 |
| 编辑计划当天实例 | 保持旧 scheduled_at | — |
| 次日起实例 | 新 version 新 key | — |
| 无 active 规则完成日程 | 仅完成，无积分（M2 E2E 须先启用规则） | 200 |
| 夏令时 | `Asia/Shanghai` 无 DST；无需特殊分支 | — |
| 跨日边界 20:00 | 单元测试 `family_date` 与 `scheduled_at` | — |

**M2 不做**：事实更正、反向流水、18:00 扣分、迟完成奖励、人工确认。

## 7. API 与页面数据流

### 7.1 API 清单（M2 最小）

| 方法 | 路径 | 角色 |
| --- | --- | --- |
| POST | `/api/family/students/[id]/formal-plans` | 家长 |
| GET | `/api/family/students/[id]/formal-plans/current` | 家长、学生 |
| PATCH | `/api/formal-plans/[planId]` | 家长 owner |
| POST | `/api/formal-plans/[planId]/deactivate` | 家长 owner |
| GET | `/api/family/students/[id]/schedule-items?from&to` | 家长、学生（**只读**；含 effectiveStatus） |
| POST | `/api/schedule-items/[itemId]/complete` | 学生 |
| POST | `/api/family/students/[id]/point-rules` | 家长 |
| GET | `/api/family/students/[id]/points/balance` | 家长、学生 |
| GET | `/api/family/students/[id]/points/ledger?limit` | 家长、学生 |

### 7.2 页面（M2 最小）

| 路由 | 角色 | 职责 |
| --- | --- | --- |
| `/parent/students/[id]/plan` | 家长 | 创建/编辑/停用计划；启用积分规则 |
| `/parent/students/[id]/schedule` | 家长 | 查看日程与积分摘要 |
| `/student/schedule` | 学生 | 今日待办、完成按钮 |
| `/student/points` | 学生 | 余额与最近流水 |
| 首页卡片扩展 | 双方 | 今日 20:00 任务 + 积分（可嵌入现有 home） |

数据流：`page.tsx` → `src/lib/client/api.ts` → Route Handler → Module → DB；敏感读写在 Handler 调 `family-access` 授权。

## 8. 时区与 Time Policy

```typescript
// 伪代码 — 实现于 src/modules/time/family-time.ts
toFamilyDate(utc: Date): string       // Asia/Shanghai YYYY-MM-DD
toScheduledAt(familyDate, localTime): Date  // UTC instant
nextFamilyDate(from: Date): string    // 编辑生效日 = 明日 family_date
familyDateRange(start, horizonDays): string[]
```

- 存储：时间戳 UTC；`family_date` 为 DATE 或 string；`local_time` 为 `HH:mm`。
- 测试：固定 clock 注入（Vitest `vi.setSystemTime`）覆盖 23:59→00:00 边界。

## 9. Outbox 与审计（M2）

| 事件 | aggregate | dedupe_key 示例 |
| --- | --- | --- |
| `plan.created` | plan | `plan.created:{plan_id}` |
| `plan.version_created` | plan | `plan.version:{version_id}` |
| `schedule.completed` | schedule_item | `schedule.completed:{item_id}` |
| `points.settled` | settlement | `points.settled:{settlement_id}` |

审计 `action` 示例：`formal_plan.created`、`schedule_item.completed`、`point_ledger.created`。

## 10. 已批准决策（2026-08-26）

| # | 决策 | 批准值 |
| --- | --- | --- |
| D1 | 结算方式 | **同步 inline**，与 completed fact / settlement / ledger / balance / audit / outbox **同一事务** |
| D2 | 固定模板分值 | **+10 分/次完成**（`schedule_system_complete_v1`） |
| D3 | 实例生成 horizon | **30 天滚动** |
| D4 | 过期持久化 | **禁止 GET 写库**；列表 **effectiveStatus** 只读计算；持久化 expired 仅于**完成尝试**或**维护命令事务** |
| D5 | 命令幂等 | **不新增** command 表；**表级** idempotency_key + actor/scope UNIQUE（§5.7） |
| D6 | 跳过日程 UI | **仅 API + 集成测试**；E2E 不要求 |
| D7 | goal 绑定 | **M2 不绑 goal** |
| D8 | 启用积分规则 | **独立步骤**（E2E 在完成后前先启用） |

## 11. 测试策略摘要

- **单元**：Time Policy、occurrence_key 构建、状态机。
- **集成**：每写命令幂等、UNIQUE 约束、事务回滚（结算失败则不 completed）。
- **E2E**：`m2-schedule-points-flow.spec.ts` — 建计划 → 启用规则 → 学生完成 → 断言 ledger 一条 → 刷新/重登/重复 POST 不断档。
- **视口**：desktop-chromium + mobile-360（复用 Playwright projects）。

## 12. 回滚与迁移

见 `implement.md` §迁移顺序与回滚。
