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

> 逐表约束与 `design.md` §4.2 一一对应；实现前须按此 DDL 审查。

### 2.0 0008 `plans_and_versions.sql`

**`plans`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `owner_id`, `student_id` | UUID | FK → users；NOT NULL |
| `status` | enum | `active` \| `inactive` |
| `create_idempotency_key`, `create_idempotency_payload_hash` | text | NOT NULL（create 路径） |
| `deactivate_idempotency_key`, `deactivate_idempotency_payload_hash` | text | NULL 直至 deactivate |
| `end_date` | date | NULL 允许 |

| 约束 | 定义 |
| --- | --- |
| UNIQUE create | `(owner_id, student_id, create_idempotency_key)` |
| UNIQUE deactivate | `(id, deactivate_idempotency_key)` WHERE deactivate key NOT NULL |
| active formal | **部分 UNIQUE** `(student_id) WHERE status = 'active' AND plan_type = 'formal'` |

**`plan_versions`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `plan_id` | UUID | FK → plans ON DELETE RESTRICT |
| `version_number` | int | NOT NULL |
| `effective_from` | date | NOT NULL |
| `create_idempotency_key`, `create_idempotency_payload_hash` | text | NOT NULL |

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
| `plan_id`, `plan_version_id`, `student_id` | UUID | FK；NOT NULL |
| `family_date` | date | NOT NULL |
| `scheduled_at` | timestamptz | NOT NULL |
| `occurrence_key` | text | NOT NULL |
| `status` | text | CHECK IN (`pending`,`completed`,`skipped`,`expired`,`cancelled`) |

| 约束 | UNIQUE `occurrence_key` |

**`schedule_events`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUID | PK |
| `schedule_item_id` | UUID | FK → schedule_items |
| `event_type` | text | CHECK IN (`complete`,`skip`) |
| `actor_id` | UUID | FK → users；NOT NULL |
| `idempotency_key`, `idempotency_payload_hash` | text | NOT NULL |
| `completion_kind` | text | NULL（skip）或 CHECK IN (`on_time`,`late`)（complete） |
| `occurred_at` | timestamptz | NOT NULL |

| 约束 | UNIQUE `(schedule_item_id, idempotency_key)` |

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

**`point_rule_templates`** — seed `schedule_system_complete_v1`（+10，`rewardsLateCompletion: true`）。

**`point_rules` / `point_rule_versions`** — `create_idempotency_key` + hash；UNIQUE `(creator_parent_id, student_id, create_idempotency_key)`。

### 2.0.4 0012 `settlements_ledger_balance.sql`

**`settlements`**

| 约束 | UNIQUE `(fact_version_id, rule_version_id, settlement_period)` |

**`point_ledger_entries`**

| 约束 | UNIQUE `settlement_id`；**无**全局 `UNIQUE(idempotency_key)` |
| 列 | `idempotency_key` 可存客户端 key（审计）；冲突以 `settlement_id` 为准 |

**`point_balance_projection`**

| 列 | PK `student_id` |
| UPSERT | `INSERT … ON CONFLICT (student_id) DO UPDATE SET balance = balance + EXCLUDED.delta` |
| 规则 | **仅** ledger `INSERT … RETURNING id` 成功时累加 |

### 2.0.5 0013 `schedule_horizon_maintains.sql`

| 约束 | UNIQUE `(student_id, actor_id, idempotency_key)` |

### 2.1 迁移索引（摘要）

| 序号 | 文件 | 要点 |
| --- | --- | --- |
| 0008 | `plans_and_versions.sql` | §2.0 三表 |
| 0009 | `schedule_items_events.sql` | §2.0.1；status/event CHECK |
| 0010 | `fact_versions.sql` | §2.0.2 |
| 0011 | `points_templates_rules.sql` | §2.0.3 |
| 0012 | `settlements_ledger_balance.sql` | §2.0.4；ledger 无全局 idempotency UNIQUE |
| 0013 | `schedule_horizon_maintains.sql` | §2.0.5 |

### 2.2 Seed

- 迁移或 seed 脚本插入 `point_rule_templates`：`schedule_system_complete_v1`（+10，`rewardsLateCompletion: true`）。
- E2E bootstrap：预置家长 + 关联学生；步骤 3 调用启规则 API。

### 2.3 回滚

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
| `formal-plan.test.ts` | 1,6,F2,F8,F9,F9b,F19,F21 |
| `plan-end-date.test.ts` | F22（endDate 上界、缩短 endDate、maintain no-op） |
| `maintain-horizon.test.ts` | F14,F22；编辑后 horizon；无 mount |
| `schedule-generation.test.ts` | 2 |
| `schedule-query.test.ts` | F5,F6 |
| `schedule-complete.test.ts` | 3,F3,F7,F11,F15,F20,F24 |
| `schedule-skip.test.ts` | F16,F17,F18,F20,F24 |
| `schedule-terminal-concurrency.test.ts` | F24（complete×complete、complete×skip 同/异 key） |
| `settlement-ledger.test.ts` | 4,5,F4,F15,F25（ledger 冲突 balance 不变；跨 item 同 key） |
| `schedule-auth.test.ts` | F1 |
| `schedule-outbox.test.ts` | 8,F21 |
| `command-idempotency.test.ts` | F9–F13,F20 |
| `write-route-idempotency-header.test.ts` | F23（七类写 Route 缺 header → 400） |

### 4.2.1 C6–C9 测试计划（7804743 闭合）

| C-ID | 测试文件 | 断言 |
| --- | --- | --- |
| C6 | `plan-end-date.test.ts` | 创建带 endDate；实例 ≤ min(endDate,today+30)；缩短 endDate 取消 future pending；maintain 已结束 no-op |
| C7 | `schedule-terminal-concurrency.test.ts` | 并发同 key → 200 回放、1 event/fact/ledger；异 key 后到 → 409 |
| C8 | `write-route-idempotency-header.test.ts` | 七 Route 无 header → 400 `IDEMPOTENCY_KEY_REQUIRED` |
| C9 | `settlement-ledger.test.ts` | ledger ON CONFLICT 无 balance 累加；两 item 同客户端 key 各 +10 |

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
- [ ] `git diff --check` 通过

## 7. 明确禁止（Implement 阶段）

- `task.py start` 前禁止本列表外 M2 代码
- Outbox Worker / 死信 / 投影重建 CLI
- 人工事实、冲销、command_log 表
- mount 自动 maintain-horizon
- GET 隐式写库或生成
- 多家长 UI、Stroop、TOTP、路径 B、goal 绑定、兑换
- 新建 `src/modules/time/` 并行模块
