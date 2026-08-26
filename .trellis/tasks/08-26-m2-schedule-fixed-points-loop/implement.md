# M2 实施计划

> **门禁**：负责人批准 `prd.md` + `design.md` + 本文档后，方可 `task.py start`、创建实现分支、编写迁移与业务代码。

## 1. 实施顺序

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **0** | D1–D8 已批准（2026-08-26）；见 `design.md` §10 | — |
| **1** | 数据迁移 0008–0012（见 §2）+ Drizzle schema | `pnpm db:migrate`；空库 UP/DOWN smoke |
| **2** | Time Policy 模块 + 单元测试 | `pnpm test` time 相关 |
| **3** | Schedule Module：计划 CRUD、实例生成、**expirePastPending**、完成/跳过 | 集成测试绿 |
| **4** | Settlement Module：模板 seed、规则启用、同步结算、余额投影 | 集成测试绿 |
| **5** | Route Handlers + Zod + Idempotency-Key 中间件模式（对齐 M1） | API 集成测试 |
| **6** | 家长/学生 Web 页面（最小） | 手动 + E2E |
| **7** | E2E `m2-schedule-points-flow` desktop + mobile-360 | `pnpm test:e2e` |
| **8** | 文档：`research/m2-verification-evidence.md`（实施后填） | 验收矩阵全绿 |

**禁止跳步**：未通过 UNIQUE 约束与幂等集成测试前不得写 E2E「happy path only」。

## 2. 迁移顺序与回滚

### 2.1 顺序（expand-only）

| 序号 | 文件 | 内容 |
| --- | --- | --- |
| 0008 | `plans_and_versions.sql` | `plans`, `plan_versions`, `plan_schedule_slots` |
| 0009 | `schedule_items_events.sql` | `schedule_items`, `schedule_events` |
| 0010 | `fact_versions.sql` | `fact_versions` |
| 0011 | `points_templates_rules.sql` | `point_rule_templates`, `point_rules`, `point_rule_versions` |
| 0012 | `settlements_ledger_balance.sql` | `settlements`, `point_ledger_entries`, `point_balance_projection` |

每步迁移仅 ADD TABLE/INDEX/CONSTRAINT；不 DROP M1 表。

### 2.2 回滚策略

| 层级 | 方式 |
| --- | --- |
| **应用回滚** | 关闭 M2 路由（feature flag 或移除注册）；M1 路径不受影响 |
| **数据回滚** | 非生产：按迁移倒序 DROP M2 表（仅无生产数据时）；生产：**不**删表，以 `deactivate` 计划 + 停止写入 |
| **积分错误** | M2 **不支持**冲销；仅能通过 DB 运维手工处理（违反产品规则）；正确修复留 M3 |
| **错误部署** | 回滚到上一应用版本；M2 表可留空；outbox pending 无 Worker 无副作用 |

### 2.3 Seed

- `scripts/seed-m2.ts`（或扩展 `seed-m1.ts`）：插入固定 `point_rule_templates`（`schedule_system_complete_v1`，**+10 分**）；可选 demo 计划（仅 dev）。
- E2E bootstrap：确保关联家庭 + 启用规则 API 可调用。

## 3. 文件布局（预期新增）

```
src/modules/schedule/
  plan.service.ts
  schedule-generation.service.ts
  schedule-query.service.ts      # effectiveStatus，禁止写库
  expire-past-pending.service.ts # 仅维护/完成命令事务调用
  complete-schedule.service.ts
  errors.ts
src/modules/settlement/
  point-rule.service.ts
  settlement.service.ts
  ledger.service.ts
  errors.ts
src/modules/time/
  family-time.ts
src/db/schema/schedule.ts
src/db/schema/points.ts
src/app/api/family/students/[studentId]/formal-plans/...
src/app/api/formal-plans/[planId]/...
src/app/api/schedule-items/[itemId]/complete/...
src/app/parent/students/[studentId]/plan/page.tsx
src/app/student/schedule/page.tsx
tests/integration/schedule/
tests/integration/settlement/
tests/e2e/m2-schedule-points-flow.spec.ts
```

## 4. 测试矩阵

### 4.1 单元测试

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/time/family-time.test.ts` | family_date、scheduled_at、nextFamilyDate、上海边界 |
| `tests/unit/schedule/occurrence-key.test.ts` | key 格式稳定 |
| `tests/unit/schedule/effective-status.test.ts` | effective expired 只读计算 |

### 4.2 集成测试

| 文件 | AC 映射 |
| --- | --- |
| `formal-plan.test.ts` | AC-M2-1, AC-M2-6, AC-M2-F2, AC-M2-F8 |
| `schedule-generation.test.ts` | AC-M2-2 |
| `schedule-query.test.ts` | AC-M2-F5, AC-M2-F6 |
| `schedule-complete.test.ts` | AC-M2-3, AC-M2-F3, AC-M2-F7 |
| `schedule-skip.test.ts` | D6 API-only skip（无 E2E） |
| `settlement-ledger.test.ts` | AC-M2-4, AC-M2-5, AC-M2-F4 |
| `schedule-auth.test.ts` | AC-M2-F1 |
| `schedule-outbox.test.ts` | AC-M2-8 |
| `command-idempotency.test.ts` | AC-M2-F9–F13；§5.7 每命令重放/冲突 |

### 4.3 E2E 主路径

**Spec**：`tests/e2e/m2-schedule-points-flow.spec.ts`

```text
1. 预置：家长登录、已关联学生（复用 M1 bootstrap）
2. 家长：创建正式计划「完成作业」daily 20:00
3. 家长：**独立步骤**启用固定积分模板（D8）
4. 学生：登录 → 今日日程可见 → 点击完成
5. 断言：积分 +10（D2）；ledger 1 条；reason 含计划标题
6. 学生：刷新 → 余额仍为 +10
7. 学生：重复 complete（同 Idempotency-Key）→ 仍 1 条 ledger
8. 家长：mobile-360 查看积分摘要
```

**连续执行**：E2E 监督器 `pnpm test:e2e` 两轮端口释放（沿用 M1）。

### 4.4 静态检查

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm build && pnpm test:e2e
```

## 5. 与 M1 的衔接

- 复用：`appendOutboxEvent`、`auth-request`、`family-access` 授权、`page-shell` UI、`run-e2e.mts` 监督器。
- 不修改：`.trellis/tasks/08-25-m1-*` 历史文档；M1 集成/E2E 须保持绿。
- 分支：`feat/m2-schedule-fixed-points-loop` from `main`。

## 6. 实施检查清单（Implement Agent）

- [ ] 迁移 UP 成功且 UNIQUE 约束存在（含 §5.7 各 idempotency scope）
- [ ] GET schedule-items **零写库**（code review + AC-M2-F5 测试）
- [ ] expirePastPending 仅出现在维护/完成命令事务
- [ ] 所有写路径事务含 audit + outbox
- [ ] 余额更新无 bypass ledger 路径（code review grep `point_balance_projection` UPDATE）
- [ ] Idempotency-Key 在 Route Handler 层强制（非可选）
- [ ] 360px 主路径无横向滚动
- [ ] `research/m2-verification-evidence.md` 填写实测输出

## 7. 明确不实施（Implement 阶段禁止）

- Outbox Worker / dead letter / 投影重建 CLI
- 人工事实确认、fact 更正、反向 ledger
- 多家长 UI、Stroop、TOTP、路径 B
- 个人计划、转化、手动日程、兑换、手动奖励
- 新第三方依赖（D1–D8 已冻结，变更须重开规划）
