# P2 Implementation Record：训练主体隔离与 expand 迁移

## Fixed handover

- Active task：`09-04-credential-training-access`
- Branch：`main`
- Directive SHA：`e6eb1c61cb654437839d836717dc83f6cc6234c2`
- Implementation baseline：`9985bc8097445c1aa02ab3b47e614a564cb7845c`
- Remediation baseline：`4048c8166868152d855457d81dcbed09416c5dae`
- Scope：P2 only（`R-CTA-03` 服务端 / schema / migration / API；不含家长训练 UI、schema contract、P3）

## Requirement mapping

| R / AC / 不变量 | Delivery |
|-----------------|----------|
| TrainingSubject | `src/modules/training/training-subject.ts`：`{ traineeId, traineeRole, ageBand }`；student 由出生日期解析；parent 固定 `adult`；admin fail closed |
| Service authority | 所有公开 `*ForSubject` 入口经 `authorizeTrainingSubject` 重新解析并比对角色/年龄档；伪造 claim fail closed；仅 student 走冻结/outbox |
| Expand migration | `0032_p2_training_trainee_id.sql`：nullable → 回填 → NOT NULL + FK；`student_id` 可空兼容；新 trainee 索引/唯一约束；旧约束保留 |
| Legacy isolation | `0033_p2_training_trainee_remediation.sql`：`student_id IS NULL OR student_id = trainee_id` CHECK（sessions + projection）；不做 contract |
| adult 定义部署 | `0033` INSERT 三 key active `adult`（ON CONFLICT DO NOTHING）；不改儿童历史行；无需 seed/人工动作 |
| 事务原子性 | start / cancel / abandon：业务写入与 audit 同事务；失败双回滚 |
| 家长隔离 | 家长 submit 更新自身 metrics/projection + audit；**不**写 outbox；不碰学生积分/日程/推送/通知 |
| API 主体 | `requireTraineeSession*`；通用训练 API 仅用当前认证 user；body 无 owner ID |
| 投影 rebuild | `rebuildTrainingProfileProjectionForTrainee`；全量 DISTINCT `trainee_id` |

## Key files

- Migration：`0032_p2_training_trainee_id.sql`、`0033_p2_training_trainee_remediation.sql`、`meta/_journal.json`
- Schema：`src/db/schema/training.ts`（含 student/trainee match CHECK）
- Subject：`training-subject.ts`
- Services：`session.service.ts`（authority + 原子事务）、`definition.service.ts`、`trends.service.ts`、`account-deletion.service.ts`、`submit-competition-lock-key.ts`
- Auth：`src/lib/auth-request.ts`（`requireTraineeSession` / `ForWrites`）
- Routes：`/api/training/sessions/**`
- Tests：`tests/integration/migrations/p2-training-trainee-id.test.ts`、`tests/integration/training/p2-training-subject.test.ts`、`tests/integration/api/p2-training-subject-routes.test.ts`

## Invariant coverage

| 类别 | 证据 |
|------|------|
| 迁移回填 | 隔离库：预置历史 session/projection → 0032 后 `trainee_id = student_id`；新旧索引并存；effective 唯一 23505 |
| CHECK | 0033 后直接 SQL：`student_id ≠ trainee_id` → 23514（sessions + projection） |
| adult 部署 | 0033 后、无 adult seed：三 key active adult 存在；家长 `getActiveTrainingDefinition(..., adult)` 成功；儿童 9-12 行未改 |
| 授权 | parent/student 可训；admin 403；跨主体 SESSION_NOT_FOUND；admin 伪装 parent / student 伪装 parent+adult → FORBIDDEN |
| 原子性 | cancel：audit mock 失败 → session 仍 active、无 cancel audit |
| 隔离 | 同日同 key 双方均可 effective；家长无 outbox；学生 ledger/schedule/projection 不变；家长 projection `student_id` null / `adult` |
| 并发/幂等 | trainee 作用域 start/submit 唯一索引 + effective 日唯一；submit 竞争锁键改 traineeId |
| API | parent/student 无 owner body；student 非 adult；admin 拒绝 |

## Concentrated remediation (post `4048c81`)

1. Service authority：`authorizeTrainingSubject` 覆盖全部公开 `*ForSubject`
2. Legacy CHECK + SQL 负例
3. Migration 部署 adult 定义（无 seed 依赖验证）
4. start/cancel/abandon 与 audit 同事务 + cancel 失败回滚回归

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/migrations/p2-training-trainee-id.test.ts tests/integration/training/p2-training-subject.test.ts tests/integration/api/p2-training-subject-routes.test.ts` | exit 0 — 3 files / 8 tests passed |
| `git diff --check` | exit 0 — clean |

## Not executed

- 全量 test / 全量 E2E / build / Docker / `pnpm dev`：指令禁止
- P3 家长训练 UI / runner 路由：范围外
- schema contract（删除 `student_id` / 旧索引）：范围外
- typecheck / lint / format：本轮整改指令未要求；未执行

## Risks / open review items

- 旧 `student_id` 唯一索引对 parent（`student_id` NULL）不构成约束；隔离依赖新 `trainee_id` 索引 + CHECK——符合 expand 设计
- 家长训练 audit 保留、outbox 跳过；若后续 worker 需家长事件须另开任务
- 临时 `studentId` facade 仍供既有测试/helper；新增入口已用 `TrainingSubject` + service 内再授权
