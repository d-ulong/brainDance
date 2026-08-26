# M2 实施计划

> **门禁**：批准 prd + design + 本文档后，方可 `task.py start` 与实现。

## 1. 实施顺序

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **0** | 规划复审 consolidated signoff 包已闭合 | `PLANNING-REVIEW.md`；design §4.6–§5.0/§11；checklist A–E |
| **1** | 迁移 0008–0013 | `pnpm db:migrate` |
| **2** | 扩展 `src/modules/time-policy/` | `tests/unit/time-policy/` |
| **3** | Schedule：CRUD、inline horizon、maintain-horizon、complete/skip | 集成测试 |
| **4** | Settlement +10 / late | 集成测试 |
| **5** | Route Handlers | API 测试 |
| **6** | Web（**补齐日程**按钮，无 mount POST） | 手动 |
| **7** | E2E desktop + mobile-360 完整链路 | `pnpm test:e2e` |
| **8** | `research/m2-verification-evidence.md` | 矩阵全绿 |

## 2. 迁移

> 逐表约束与 `design.md` §4.2 及 **`docs/data-model.md` §4–§5** 对齐；§2.0.7 为权威对照表。

### 2.0 0008 `plans_and_versions.sql`

**`plans`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `student_id`, `owner_id` | UUID | FK → users；NOT NULL（顺序对齐 data-model） |
| `goal_id` | UUID | FK → goals；**NULL**（M2 不绑 goal） |
| `plan_kind` | text | NOT NULL；M2 固定 `formal` |
| `source_plan_id` | UUID | FK → plans；**NULL**（M2 无 personal 转化） |
| `status` | text | CHECK IN (`active`,`inactive`) |
| `current_version_id` | UUID | FK → plan_versions；NULL 直至 v1 写入后 UPDATE |
| `title` | text | NOT NULL |
| `description` | text | NULL |
| `start_date` | date | NOT NULL |
| `end_date` | date | NULL |
| `create_idempotency_key`, `create_idempotency_payload_hash` | text | NOT NULL（create 路径） |
| `deactivate_idempotency_key`, `deactivate_idempotency_payload_hash` | text | NULL 直至 deactivate |

| 约束 | 定义 |
| --- | --- |
| UNIQUE create | `(owner_id, student_id, create_idempotency_key)` |
| UNIQUE deactivate | `(id, deactivate_idempotency_key)` WHERE deactivate key NOT NULL |
| active formal | **部分 UNIQUE** `(student_id) WHERE status = 'active' AND plan_kind = 'formal'` |

**`plan_versions`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `plan_id` | UUID | FK → plans ON DELETE RESTRICT |
| `version` | int | NOT NULL（data-model 字段名 `version`） |
| `schedule_rule` | jsonb | NOT NULL；M2 `{ "frequency": "daily" }` |
| `effective_from` | date | NOT NULL |
| `effective_until` | date | NULL |
| `created_at` | timestamptz | NOT NULL |
| `create_idempotency_key`, `create_idempotency_payload_hash` | text | NOT NULL（M2 幂等扩展） |

| 约束 | UNIQUE `(plan_id, create_idempotency_key)` |

**`plan_schedule_slots`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `plan_version_id` | UUID | FK → plan_versions |
| `slot_key` | text | M2 固定 `default` |
| `local_time` | time | NOT NULL（如 20:00） |

| 约束 | UNIQUE `(plan_version_id, slot_key)` |

### 2.0.1 0009 `schedule_items_events.sql`

**`schedule_items`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `plan_id`, `plan_version_id`, `student_id`, `owner_id` | UUID | FK；NOT NULL |
| `family_date` | date | NOT NULL |
| `slot_key` | text | NOT NULL；M2 固定 `default` |
| `scheduled_at` | timestamptz | NOT NULL |
| `status` | text | CHECK IN (`pending`,`completed`,`skipped`,`expired`,`cancelled`) |
| `source` | text | NOT NULL DEFAULT `plan` |
| `occurrence_key` | text | NOT NULL |
| `plan_snapshot` | jsonb | NULL（M2 可选） |

| 约束 | UNIQUE `occurrence_key` |

**`schedule_events`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `schedule_item_id` | UUID | FK → schedule_items |
| `actor_id` | UUID | FK → users；NOT NULL |
| `from_status` | text | NOT NULL；M2 固定 `pending` |
| `to_status` | text | NOT NULL；`completed` \| `skipped` |
| `idempotency_key`, `idempotency_payload_hash` | text | NOT NULL |
| `completion_kind` | text | NULL 允许（M2 扩展；complete 必填） |
| `occurred_at` | timestamptz | NOT NULL |

| 约束 | UNIQUE `(schedule_item_id, idempotency_key)` |
| CHECK | `from_status IN ('pending')`；`to_status IN ('completed','skipped')` |
| 复合 CHECK | `(to_status='completed' AND completion_kind IN ('on_time','late')) OR (to_status='skipped' AND completion_kind IS NULL)` |

### 2.0.2 0010 `fact_versions.sql`

| 列 | 约束 |
| --- | --- |
| `id` | PK |
| `schedule_item_id`, `student_id` | FK；NOT NULL |
| `fact_key` | `schedule.completed` |
| `idempotency_key`, `idempotency_payload_hash` | NOT NULL |
| `completion_kind` | CHECK IN (`on_time`,`late`)；NOT NULL |
| `occurred_at`, `asserted_at`, `recorded_at` | timestamptz NOT NULL |

| 约束 | UNIQUE `(schedule_item_id, idempotency_key)` |

### 2.0.3 0011 `points_templates_rules.sql`

**`point_rule_templates`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK；M2 seed `schedule_system_complete_v1` |
| `event_type` | text | NOT NULL；`schedule.completed` |
| `parameter_schema` | jsonb | NOT NULL；M2 空对象 `{}` |
| `effect_schema` | jsonb | NOT NULL；`{ amount: 10, rewardsLateCompletion: true }` |
| `negative_effect_schema` | jsonb | NULL（M2 未用） |
| `limits` | jsonb | NULL（M2 未用） |
| `stacking_mode` | text | NOT NULL DEFAULT `none` |
| `active` | boolean | NOT NULL DEFAULT true |
| `created_at` | timestamptz | NOT NULL |

**`point_rules`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `student_id`, `creator_parent_id` | UUID | FK → users；NOT NULL |
| `template_id` | text | FK → point_rule_templates；NOT NULL |
| `status` | text | CHECK IN (`active`,`inactive`)；M2 启用后 `active` |
| `create_idempotency_key`, `create_idempotency_payload_hash` | text | NOT NULL |
| `created_at` | timestamptz | NOT NULL |

| 约束 | UNIQUE `(creator_parent_id, student_id, create_idempotency_key)` |
| 部分 UNIQUE | `(student_id) WHERE status = 'active'`（M2 每学生 ≤1 active rule） |

**`point_rule_versions`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `point_rule_id` | UUID | FK → point_rules ON DELETE RESTRICT |
| `version` | int | NOT NULL（data-model 字段名 `version`） |
| `parameters` | jsonb | NOT NULL；M2 `{}` |
| `effect` | jsonb | NOT NULL；自模板复制 +10 |
| `effective_at` | timestamptz | NOT NULL |
| `status` | text | CHECK IN (`active`,`superseded`) |

| 约束 | UNIQUE `(point_rule_id, version)` |

### 2.0.4 0012 `settlements_ledger_balance.sql`

**`settlements`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `student_id`, `fact_version_id`, `rule_version_id` | UUID | FK；NOT NULL |
| `settlement_period` | date | NOT NULL；= `schedule_item.family_date` |
| `result` | text | CHECK IN (`reward`) |
| `explanation` | text | NOT NULL |
| `idempotency_key` | text | NOT NULL |

| 约束 | UNIQUE `(fact_version_id, rule_version_id, settlement_period)` |

**`point_ledger_entries`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `student_id`, `settlement_id` | UUID | FK；NOT NULL |
| `amount` | int | NOT NULL（M2 固定 +10） |
| `reason`, `source_type`, `explanation` | text | NOT NULL |
| `idempotency_key` | text | NOT NULL（审计；**非** UNIQUE scope） |

| 约束 | UNIQUE `settlement_id` |

**`point_balance_projection`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `student_id` | UUID | PK；FK → users |
| `balance` | int | NOT NULL DEFAULT 0 |
| `last_ledger_entry_id` | UUID | FK → point_ledger_entries；NULL 直至首条 ledger |
| `updated_at` | timestamptz | NOT NULL |

| UPSERT | `INSERT INTO point_balance_projection (student_id, balance, last_ledger_entry_id) VALUES (:student_id, :amount, :ledger_id) ON CONFLICT (student_id) DO UPDATE SET balance = point_balance_projection.balance + EXCLUDED.balance, last_ledger_entry_id = EXCLUDED.last_ledger_entry_id, updated_at = now()` |
| 规则 | **仅** ledger `INSERT … RETURNING id` 成功时执行；`:amount = +10`；表**无** amount 列 |

### 2.0.5 0013 `schedule_horizon_maintains.sql`

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `student_id`, `actor_id` | UUID | FK；NOT NULL |
| `idempotency_key`, `idempotency_payload_hash` | text | NOT NULL |
| `items_created` | int | NOT NULL DEFAULT 0 |
| `created_at` | timestamptz | NOT NULL |

| 约束 | UNIQUE `(student_id, actor_id, idempotency_key)` |

### 2.0.7 `docs/data-model.md` 对齐表（禁止漂移）

| 实体 | data-model §4/§5 必填列 | implement 节 | M2 仅扩展列 |
| --- | --- | --- | --- |
| `plans` | student_id, owner_id, plan_kind, status, current_version | §2.0 → `current_version_id` | title, description, start/end_date, idempotency hash |
| `plan_versions` | version, schedule_rule, effective_from, effective_until, created_at | §2.0 | create idempotency key+hash |
| `plan_schedule_slots` | plan_version_id, slot_key, local_time | §2.0 | — |
| `schedule_items` | owner_id, slot_key, source, occurrence_key, plan_snapshot | §2.0.1 | — |
| `schedule_events` | from_status, to_status, actor_id, occurred_at, idempotency_key | §2.0.1 | idempotency_payload_hash, completion_kind |
| `fact_versions` | fact_key, source_kind, occurred_at, asserted_at, recorded_at | §2.0.2 | idempotency hash, completion_kind |
| `point_rule_templates` | event_type, parameter/effect/negative_effect_schema, stacking_mode, limits, active | §2.0.3 | — |
| `point_rules` / `point_rule_versions` | student_id, creator_parent_id, template_id, version, parameters, effect, effective_at | §2.0.3 | create idempotency；status 列 |
| `settlements` | settlement_period, result, explanation, idempotency_key | §2.0.4 | — |
| `point_ledger_entries` | amount, reason, source_type, idempotency_key | §2.0.4 | settlement_id UNIQUE |
| `point_balance_projection` | balance, last_ledger_entry_id, updated_at | §2.0.4 | — |

迁移约束测试须覆盖上表「必填列」存在性及 CHECK（§2.2.1）。

### 2.0.6 design §4.2 ↔ implement §2.0 交叉表

| design §4.2 表 | implement 节 | 必含约束 |
| --- | --- | --- |
| `plans` | §2.0 | plan_kind；current_version_id；data-model §4 列 |
| `plan_versions` | §2.0 | `version`（非 version_number）；schedule_rule |
| `schedule_items` | §2.0.1 | owner_id, slot_key, source, plan_snapshot |
| `schedule_events` | §2.0.1 | from_status/to_status + completion_kind 复合 CHECK |
| `point_balance_projection` | §2.0.4 | last_ledger_entry_id |
| `fact_versions` | §2.0.2 | completion_kind NOT NULL；item+key UNIQUE |
| `point_rule_templates` | §2.0.3 | PK id；seed schedule_system_complete_v1 |
| `point_rules` | §2.0.3 | creator+student+key UNIQUE；active 部分 UNIQUE |
| `point_rule_versions` | §2.0.3 | (point_rule_id, version) UNIQUE |
| `settlements` | §2.0.4 | `(fact_version_id, rule_version_id, settlement_period)` UNIQUE |
| `point_ledger_entries` | §2.0.4 | UNIQUE settlement_id；**无**全局 idempotency UNIQUE |
| `point_balance_projection` | §2.0.4 | PK student_id；UPSERT 仅随 ledger RETURNING |
| `schedule_horizon_maintains` | §2.0.5 | `(student_id, actor_id, idempotency_key)` UNIQUE |

### 2.1 迁移索引（摘要）

| 序号 | 文件 | 要点 |
| --- | --- | --- |
| 0008 | `plans_and_versions.sql` | §2.0 三表 |
| 0009 | `schedule_items_events.sql` | §2.0.1；status/event CHECK |
| 0010 | `fact_versions.sql` | §2.0.2 |
| 0011 | `points_templates_rules.sql` | §2.0.3 三表 + seed |
| 0012 | `settlements_ledger_balance.sql` | §2.0.4；ledger 无全局 idempotency UNIQUE |
| 0013 | `schedule_horizon_maintains.sql` | §2.0.5 |

### 2.2.1 迁移约束测试

**文件**：`tests/integration/migrations/m2-schema-constraints.test.ts`

| 断言 | 覆盖 |
| --- | --- |
| data-model §2.0.7 必填列存在（plans/plan_versions/schedule_events/projection 等） | §2.0.7 |
| `plan_kind='formal'` + 部分 UNIQUE active formal | §2.0 |
| `schedule_events` from_status/to_status 复合 CHECK | §2.0.1 |
| `point_rules` UNIQUE + active 部分 UNIQUE | §2.0.3 |
| `point_ledger_entries` UNIQUE settlement_id；无全局 idempotency UNIQUE | §2.0.4 |
| `point_balance_projection` PK + last_ledger_entry_id + UPSERT | §2.0.4 |

### 2.3 Seed

- 迁移或 seed 脚本插入 `point_rule_templates`：`schedule_system_complete_v1`（+10，`rewardsLateCompletion: true`）。
- E2E bootstrap：预置家长 + 关联学生；步骤 3 调用启规则 API。

### 2.4 回滚

| 层级 | 方式 |
| --- | --- |
| 应用 | **回滚应用版本**或**移除 M2 路由注册** |
| 数据（非生产） | 倒序 DROP M2 表 |
| 生产 | deactivate + 停止写入 |
| 积分错误 | M3 冲销；M2 不支持 |

## 3. 文件布局

```
src/modules/time-policy/
  to-family-date.ts, resolve-age-band.ts
  to-scheduled-at.ts, next-family-date.ts, family-date-range.ts
  add-family-days.ts, horizon-through.ts
  completion-window.ts, derive-completion-kind.ts
src/modules/schedule/
  plan.service.ts
  generate-horizon-inline.service.ts
  maintain-horizon.service.ts
  schedule-query.service.ts
  persist-expired.service.ts     # §4.8；仅写事务；用 isPastCompletionWindow
  occurrence-key.ts              # §4.6 构建函数
  complete-schedule.service.ts
  skip-schedule.service.ts
  errors.ts
src/modules/settlement/
  point-rule.service.ts
  settlement.service.ts
  ledger.service.ts
  errors.ts
src/db/schema/schedule.ts
src/db/schema/points.ts
src/app/api/family/students/[studentId]/formal-plans/route.ts
src/app/api/family/students/[studentId]/formal-plans/maintain-horizon/route.ts
src/app/api/formal-plans/[planId]/route.ts
src/app/api/formal-plans/[planId]/deactivate/route.ts
src/app/api/schedule-items/[itemId]/complete/route.ts
src/app/api/schedule-items/[itemId]/skip/route.ts
src/app/api/family/students/[studentId]/point-rules/route.ts
src/app/api/family/students/[studentId]/points/balance/route.ts
src/app/api/family/students/[studentId]/points/ledger/route.ts
src/app/api/family/students/[studentId]/formal-plans/current/route.ts
src/app/api/family/students/[studentId]/schedule-items/route.ts
src/app/parent/students/[id]/plan/page.tsx
src/app/student/schedule/page.tsx
tests/unit/time-policy/
tests/integration/schedule/
tests/integration/settlement/
tests/integration/migrations/m2-schema-constraints.test.ts
tests/integration/api/
tests/e2e/m2-schedule-points-flow.spec.ts
```

## 4. 测试矩阵

### 4.1 单元

| 文件 | 覆盖 |
| --- | --- |
| `completion-window.test.ts` | 窗口边界 |
| `derive-completion-kind.test.ts` | on_time / late |
| `effective-status.test.ts` | 只读 expired |
| `occurrence-key.test.ts` | key 格式 §4.6 |

### 4.2 集成

| 文件 | AC |
| --- | --- |
| `formal-plan.test.ts` | 1,6,F2,F8,F9,F9b,F19,F21,F27 |
| `plan-end-date.test.ts` | F22,F28（endDate no-op **仍 persist expired**） |
| `maintain-horizon.test.ts` | F14,F22,F26,F28 |
| `schedule-generation.test.ts` | 2 |
| `schedule-query.test.ts` | F5,F6 |
| `schedule-complete.test.ts` | 3,F3,F7,F11,F15,F20,F24 |
| `schedule-skip.test.ts` | F16,F17,F18,F20,F24 |
| `schedule-terminal-concurrency.test.ts` | F24（complete×complete、complete×skip 同/异 key） |
| `settlement-ledger.test.ts` | 4,5,F4,F15,F25（首次 +10；回放 balance 不变；跨 item 同 key） |
| `schedule-auth.test.ts` | F1 |
| `schedule-outbox.test.ts` | 8,F21 |
| `command-idempotency.test.ts` | F9–F13,F20 |
| `write-route-idempotency-header.test.ts` | F23 |

### 4.2.1 复审测试映射（a55541a 闭合）

| C-ID | 测试文件 | 断言 |
| --- | --- | --- |
| C4 | `m2-schema-constraints.test.ts` | data-model §2.0.7 列存在；from_status/to_status 复合 CHECK |
| C9 | `settlement-ledger.test.ts` | EXCLUDED.balance UPSERT；last_ledger_entry_id；首次 +10；回放 balance 不变 |
| C10 | `maintain-horizon.test.ts` | F26 并发同 key：1 generate/audit/outbox |
| C10 | `formal-plan.test.ts` | F27 编辑 localTime 未变仍建 slot 并生成 |
| C11 | `maintain-horizon.test.ts` | §5.8B 回放无副作用；F28 no-op 仍 persistExpired |
| C12 | `formal-plan.test.ts` | §5.2 每 version 无条件 slot 快照 |

### 4.3 E2E

**Spec**：`tests/e2e/m2-schedule-points-flow.spec.ts`

**Projects**：`desktop-chromium` 与 `mobile-360` **各**执行步骤 1–7：

```text
1. 预置：家长 + 已关联学生
2. 家长：创建正式计划 daily 20:00
3. 家长：启用积分规则
4. 学生：完成今日日程
5. 断言：+10；ledger 1 条
6. 刷新 + 重登：余额仍 +10
7. 同 Idempotency-Key 重复 complete：仍 1 ledger
```

无 skip UI。mobile 执行完整链路，非仅查看积分。

### 4.4 静态检查

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm build && pnpm test:e2e
```

## 5. 与 M1 衔接

- **复用**：`appendOutboxEvent`、`auth-request`、family-access 授权、`page-shell`、`run-e2e.mts` 监督器、`src/modules/time-policy/to-family-date.ts`。
- **不修改**：`.trellis/tasks/08-25-m1-*` 历史文档与实现语义。
- **回归**：M1 53 项 Vitest + 10 项 E2E 保持绿。
- **分支**（implement 阶段）：`feat/m2-schedule-fixed-points-loop` from `main`。

## 6. 实施检查清单

- [ ] UNIQUE 含 `(schedule_item_id, idempotency_key)` 与 payload hash 列
- [ ] `completion_kind` 非 NULL（complete 路径）
- [ ] GET / mount **零** maintain-horizon 调用
- [ ] 内联 horizon **不**写 `schedule_horizon_maintains`
- [ ] create 回放 **不**二次 inline horizon / outbox
- [ ] 编辑 horizon 从 `effective_from` 起算
- [ ] skip 窗口外 → expired + 409
- [ ] 跨 actor 同 key → 409
- [ ] ledger UNIQUE 仅 `settlement_id`；balance 仅 INSERT RETURNING 时累加
- [ ] complete/skip 锁后重查同 key event（并发同 key 200 回放）
- [ ] horizonThrough = min(endDate, today+30)；maintain 已结束 no-op
- [ ] 七类写 Route 缺 Idempotency-Key → 400
- [ ] `plans.plan_kind`（非 plan_type）；events 复合 CHECK
- [ ] 每 plan_version 无条件 `plan_schedule_slots` 快照
- [ ] balance UPSERT 使用 EXCLUDED.balance（非 amount 列）
- [ ] 迁移列与 `docs/data-model.md` §2.0.7 对齐（无未文档化漂移）
- [ ] maintain no-op（items_created=0）仍调用 persistExpiredPastWindow
- [ ] `git diff --check` 通过

## 7. 明确禁止（Implement 阶段）

- `task.py start` 前禁止本列表外 M2 代码
- Outbox Worker / 死信 / 投影重建 CLI
- 人工事实、冲销、command_log 表
- mount 自动 maintain-horizon
- GET 隐式写库或生成
- 多家长 UI、Stroop、TOTP、路径 B、goal 绑定、兑换
- 新建 `src/modules/time/` 并行模块
