# M2 实施计划

> **门禁**：负责人批准 prd + design + 本文档后，方可 `task.py start` 与实现。

## 1. 实施顺序

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **0** | D1–D8 + 审阅修订（2026-08-26） | design §10 |
| **1** | 迁移 0008–0013 + schema | `pnpm db:migrate` |
| **2** | 扩展 **`src/modules/time-policy/`**（含 completion-window） | `tests/unit/time-policy/` |
| **3** | Schedule：计划 CRUD、**maintain-horizon**、complete/skip、expire | 集成测试 |
| **4** | Settlement：模板 +10 含迟完成 | 集成测试 |
| **5** | Route Handlers（含 skip、maintain-horizon） | API 测试 |
| **6** | Web 页面（家长页 Client 显式 POST maintain-horizon，**不在 GET**） | 手动 |
| **7** | E2E：desktop + mobile-360 **各完整链路** | `pnpm test:e2e` |
| **8** | 验收证据文档 | 矩阵全绿 |

## 2. 迁移顺序

| 序号 | 文件 | 内容 |
| --- | --- | --- |
| 0008 | `plans_and_versions.sql` | plans（含 create/deactivate key+hash）、plan_versions、slots |
| 0009 | `schedule_items_events.sql` | schedule_items、schedule_events（event_type、item+key UNIQUE） |
| 0010 | `fact_versions.sql` | fact_versions（**idempotency_key** + hash） |
| 0011 | `points_templates_rules.sql` | templates、rules（key+hash） |
| 0012 | `settlements_ledger_balance.sql` | settlements、ledger、balance |
| 0013 | `schedule_horizon_maintains.sql` | 滚动维护幂等锚点 |

### 2.2 回滚策略

| 层级 | 方式 |
| --- | --- |
| **应用回滚** | **回滚应用版本**或**移除 M2 路由注册**；M1 不受影响 |
| **数据回滚** | 非生产：倒序 DROP M2 表；生产：deactivate + 停止写入 |
| **积分错误** | M2 不支持冲销；M3 |
| **错误部署** | 回滚应用版本；M2 表可留空 |

## 3. 文件布局

```
src/modules/time-policy/
  to-family-date.ts              # 已有
  resolve-age-band.ts            # 已有
  to-scheduled-at.ts             # 新增
  next-family-date.ts
  family-date-range.ts
  completion-window.ts
src/modules/schedule/
  plan.service.ts
  schedule-generation.service.ts
  maintain-horizon.service.ts
  schedule-query.service.ts      # 只读 effectiveStatus
  persist-expired.service.ts     # 仅维护/完成事务
  complete-schedule.service.ts
  skip-schedule.service.ts
  errors.ts
src/modules/settlement/ ...
src/db/schema/schedule.ts
src/db/schema/points.ts
src/app/api/family/students/[studentId]/formal-plans/
  route.ts
  maintain-horizon/route.ts
src/app/api/formal-plans/[planId]/...
src/app/api/schedule-items/[itemId]/complete/route.ts
src/app/api/schedule-items/[itemId]/skip/route.ts
tests/unit/time-policy/
tests/integration/schedule/
tests/e2e/m2-schedule-points-flow.spec.ts
```

## 4. 测试矩阵

### 4.1 单元

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/time-policy/completion-window.test.ts` | 迟完成窗口、次日结束边界 |
| `tests/unit/time-policy/to-scheduled-at.test.ts` | scheduled_at |
| `tests/unit/schedule/effective-status.test.ts` | 只读 expired |
| `tests/unit/schedule/occurrence-key.test.ts` | occurrence_key |

### 4.2 集成

| 文件 | AC |
| --- | --- |
| `formal-plan.test.ts` | AC-M2-1,6,F2,F8,F9,F9b |
| `maintain-horizon.test.ts` | D3,F14 |
| `schedule-generation.test.ts` | AC-M2-2 |
| `schedule-query.test.ts` | F5,F6 |
| `schedule-complete.test.ts` | AC-M2-3,F3,F7,F15 |
| `schedule-skip.test.ts` | D6,F16,F17 |
| `settlement-ledger.test.ts` | AC-M2-4,5,F4,F15 |
| `schedule-auth.test.ts` | F1 |
| `schedule-outbox.test.ts` | AC-M2-8 |
| `command-idempotency.test.ts` | F9–F13；payload hash |

### 4.3 E2E

**Spec**：`tests/e2e/m2-schedule-points-flow.spec.ts`  
**Projects**：`desktop-chromium` 与 `mobile-360` **各执行完整步骤 1–7**：

```text
1. 预置：家长 + 已关联学生
2. 家长：创建正式计划 daily 20:00
3. 家长：启用积分规则（D8）
4. 学生：完成今日日程
5. 断言：+10；ledger 1 条
6. 刷新 + 重登：余额仍 +10
7. 重复 complete（同 Idempotency-Key）：仍 1 条 ledger
```

**无**跳过 UI；**无** mobile 仅查看积分摘要。

## 5–7

（与 M1 衔接、检查清单、禁止项同前；补充 maintain-horizon 不得由 GET 调用）
