# M2 验收矩阵

> 规划阶段定义（2026-08-26 修订：D4 过期语义、D5 表级幂等）；实施后由 `research/m2-verification-evidence.md` 记录实测输出。

## 1. 总览

| 类别 | 条目数 | 门禁 |
| --- | --- | --- |
| 功能 AC | 8 | 全部必须 Pass |
| 失败路径 AC | 13 | 全部必须 Pass |
| 浏览器 E2E | 1 spec × 2 projects | desktop + mobile-360（**不含**跳过 UI） |
| 静态检查 | 5 命令 | test/typecheck/lint/format/build |

## 2. 功能验收矩阵

| ID | 验收条件 | 测试方式 | Pass 标准 |
| --- | --- | --- | --- |
| AC-M2-1 | 家长创建「每天 20:00 完成作业」正式计划 | 集成 `formal-plan.test.ts` + E2E step 2 | 30 天 horizon；`family_date`/`scheduled_at` 正确 |
| AC-M2-2 | occurrence_key 稳定不重复 | 集成 `schedule-generation.test.ts` | 重复生成 0 insert；UNIQUE 约束存在 |
| AC-M2-3 | 完成事实不可覆盖 | 集成 `schedule-complete.test.ts` | fact_versions 追加；同键回放；异键 409 |
| AC-M2-4 | 唯一可解释流水 +10 | 集成 + E2E step 5 | 1 settlement + 1 ledger（+10）；reason 含计划/实例 |
| AC-M2-5 | 余额来自流水 | 集成 + E2E step 6 | balance = sum(ledger)；刷新一致 |
| AC-M2-6 | 计划变更次日起生效 | 集成 `formal-plan.test.ts` | 当天实例不变；future 按新 version 重建 |
| AC-M2-7 | 浏览器主路径 desktop + 360px | E2E `m2-schedule-points-flow.spec.ts` | 建计划→启规则→完成→积分；无横向滚动 |
| AC-M2-8 | 审计与 outbox 同事务 | 集成 `schedule-outbox.test.ts` | audit + outbox pending；dedupe 唯一 |

## 3. 失败路径矩阵

| ID | 场景 | 测试方式 | Pass 标准 |
| --- | --- | --- | --- |
| AC-M2-F1 | 未授权创建/完成 | `schedule-auth.test.ts` | 403；无 DB 副作用 |
| AC-M2-F2 | 停用计划 | `formal-plan.test.ts` | future pending → cancelled |
| AC-M2-F3 | 已完成再完成（异键） | `schedule-complete.test.ts` | 409；ledger 仍 1 条 |
| AC-M2-F4 | 结算幂等重试 | `settlement-ledger.test.ts` | 同 ledger 回放；balance 不变 |
| AC-M2-F5 | GET 列表不写库 | `schedule-query.test.ts` | 多次 GET 后 DB status 未变 |
| AC-M2-F6 | effective expired 只读 | `schedule-query.test.ts` | 响应 expired；DB 仍 pending |
| AC-M2-F7 | 完成逾期日程 | `schedule-complete.test.ts` | 持久化 expired；409；无 ledger |
| AC-M2-F8 | 维护事务批量 expired | `formal-plan.test.ts` | 创建/编辑后 past pending → expired |
| AC-M2-F9 | 创建计划幂等 | `command-idempotency.test.ts` | 同 scope 同键 200；异 payload 409 |
| AC-M2-F10 | 编辑/停用/启规则幂等 | `command-idempotency.test.ts` | 符合 design §5.7 表 |
| AC-M2-F11 | 完成幂等 | `command-idempotency.test.ts` | 同 item+键 200；异键已完成 409 |
| AC-M2-F12 | 同键不同 student 创建 | `command-idempotency.test.ts` | 两计划均成功 |
| AC-M2-F13 | 同键跨命令类型 | `command-idempotency.test.ts` | create-plan + enable-rule 均成功 |

## 4. 幂等约束验收（D5）

| 命令 | 集成断言 |
| --- | --- |
| 创建正式计划 | `plans.create_idempotency_key` UNIQUE `(owner_id, student_id, key)` |
| 编辑版本 | `plan_versions.create_idempotency_key` UNIQUE `(plan_id, key)` |
| 停用 | `plans.deactivate_idempotency_key` UNIQUE `(id, key)` |
| 完成 | `schedule_events` UNIQUE `(schedule_item_id, key)` |
| 启用规则 | `point_rules.create_idempotency_key` UNIQUE `(creator_parent_id, student_id, key)` |
| 无 command 表 | 迁移/schema 审查无 `command_idempotency` |

## 5. 路线图验收示例（必须）

**场景**：家长建立每天 20:00 完成作业的正式计划 → **启用规则** → 学生完成 → 只一条 +10 流水 → 刷新/重登/重复提交不重复记分。

| 步骤 | 验证 | 映射 |
| --- | --- | --- |
| 建计划 | E2E + AC-M2-1 | D3 |
| 启用规则 | E2E step 3 | D8 |
| 学生完成 | E2E step 4 | AC-M2-3, D1 |
| 一条 +10 流水 | E2E step 5 | AC-M2-4, D2 |
| 刷新 | E2E step 6 | AC-M2-5 |
| 重复提交 | E2E step 7 | AC-M2-F4 |
| 重登 | E2E session 重建 | AC-M2-5 |

## 6. 非功能矩阵

| ID | 条件 | 测试方式 |
| --- | --- | --- |
| NF-1 | M1 回归不破坏 | 全量 `pnpm test` ≥ 53 + 原 E2E 10 |
| NF-2 | 360px 无横向滚动 | E2E mobile-360 |
| NF-3 | 写操作 Idempotency-Key | Route 测试拒绝缺失键 |
| NF-4 | GET 零写库 | AC-M2-F5 + code review |
| NF-5 | 迁移 expand-only | 0008–0012 无 DROP M1；无 command 表 |

## 7. 明确不验收（M2）

| 项 | 原因 |
| --- | --- |
| 跳过日程 UI | D6 |
| goals 绑定 | D7 |
| Outbox Worker | M3 |
| 人工事实 / 冲销 | M3 |
| 多家长 / Stroop / TOTP / 路径 B | 见 prd Out of Scope |

## 8. 建议复验命令（实施后）

```bash
pnpm db:migrate
pnpm test
pnpm typecheck && pnpm lint && pnpm format && pnpm build
pnpm test:e2e
pnpm test:e2e
git status --short
```

## 9. 签署模板

实施后复制 M1 `reverification-signoff.md` 模式填写 GO/NO-GO。
