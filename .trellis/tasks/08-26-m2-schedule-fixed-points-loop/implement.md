# M2 实施计划

> **门禁**：批准 prd + design + 本文档后，方可 `task.py start` 与实现。

## 1. 实施顺序

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **0** | 规划复审 ee79298 缺口已闭合 | design §5–6 + implement §3 |
| **1** | 迁移 0008–0013 | `pnpm db:migrate` |
| **2** | 扩展 `src/modules/time-policy/` | `tests/unit/time-policy/` |
| **3** | Schedule：CRUD、inline horizon、maintain-horizon、complete/skip | 集成测试 |
| **4** | Settlement +10 / late | 集成测试 |
| **5** | Route Handlers | API 测试 |
| **6** | Web（**补齐日程**按钮，无 mount POST） | 手动 |
| **7** | E2E desktop + mobile-360 完整链路 | `pnpm test:e2e` |
| **8** | `research/m2-verification-evidence.md` | 矩阵全绿 |

## 2. 迁移

| 序号 | 文件 | 要点 |
| --- | --- | --- |
| 0008 | `plans_and_versions.sql` | create/deactivate key+hash |
| 0009 | `schedule_items_events.sql` | `completion_kind`；UNIQUE `(schedule_item_id, idempotency_key)` |
| 0010 | `fact_versions.sql` | idempotency_key, completion_kind |
| 0011 | `points_templates_rules.sql` | templates, rules |
| 0012 | `settlements_ledger_balance.sql` | ledger, balance |
| 0013 | `schedule_horizon_maintains.sql` | 仅独立 maintain 命令 |

### 2.2 回滚

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
  persist-expired.service.ts
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
src/app/parent/students/[id]/plan/page.tsx
src/app/student/schedule/page.tsx
tests/unit/time-policy/
tests/integration/schedule/
tests/integration/settlement/
tests/e2e/m2-schedule-points-flow.spec.ts
```

## 4. 测试矩阵

### 4.1 单元

| 文件 | 覆盖 |
| --- | --- |
| `completion-window.test.ts` | 窗口边界 |
| `derive-completion-kind.test.ts` | on_time / late |
| `effective-status.test.ts` | 只读 expired |
| `occurrence-key.test.ts` | key 格式 |

### 4.2 集成

| 文件 | AC |
| --- | --- |
| `formal-plan.test.ts` | 1,6,F2,F8,F9,F9b,F19,F21 |
| `maintain-horizon.test.ts` | F14；编辑后 horizon；无 mount |
| `schedule-generation.test.ts` | 2 |
| `schedule-query.test.ts` | F5,F6 |
| `schedule-complete.test.ts` | 3,F3,F7,F15,F20 |
| `schedule-skip.test.ts` | F16,F17,F18,F20 |
| `settlement-ledger.test.ts` | 4,5,F4,F15 |
| `schedule-auth.test.ts` | F1 |
| `schedule-outbox.test.ts` | 8,F21 |
| `command-idempotency.test.ts` | F9–F13,F20 |

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
- [ ] Idempotency-Key 强制于写 Route
- [ ] `git diff --check` 通过

## 7. 明确禁止（Implement 阶段）

- `task.py start` 前禁止本列表外 M2 代码
- Outbox Worker / 死信 / 投影重建 CLI
- 人工事实、冲销、command_log 表
- mount 自动 maintain-horizon
- GET 隐式写库或生成
- 多家长 UI、Stroop、TOTP、路径 B、goal 绑定、兑换
- 新建 `src/modules/time/` 并行模块
