# P2 Implementation Record：训练主体隔离与 expand 迁移

## Fixed handover

- Active task：`09-04-credential-training-access`
- Branch：`main`
- Directive SHA：`e6eb1c61cb654437839d836717dc83f6cc6234c2`
- Implementation baseline：`9985bc8097445c1aa02ab3b47e614a564cb7845c`
- Scope：P2 only（`R-CTA-03` 服务端 / schema / migration / API；不含家长训练 UI、schema contract、P3）

## Requirement mapping

| R / AC / 不变量 | Delivery |
|-----------------|----------|
| TrainingSubject | `src/modules/training/training-subject.ts`：`{ traineeId, traineeRole, ageBand }`；student 由出生日期解析；parent 固定 `adult`；admin fail closed |
| Expand migration | `0032_p2_training_trainee_id.sql`：nullable → 回填 → NOT NULL + FK；`student_id` 可空兼容；新 trainee 索引/唯一约束；旧约束保留 |
| adult 定义 | `definition.service.ts` seed 追加 `adult`；stroop/digit-span 提供 adult schema；不改儿童 version/active |
| 家长隔离 | 家长 submit 更新自身 metrics/projection + audit；**不**写 outbox；不碰学生积分/日程/推送/通知 |
| API 主体 | `requireTraineeSession*`；通用训练 API 仅用当前认证 user；body 无 owner ID |
| 投影 rebuild | `rebuildTrainingProfileProjectionForTrainee`；全量 DISTINCT `trainee_id` |

## Key files

- Migration：`src/db/migrations/0032_p2_training_trainee_id.sql`、`meta/_journal.json`
- Schema：`src/db/schema/training.ts`
- Subject：`training-subject.ts`
- Services：`session.service.ts`（`*ForSubject` + student facade）、`definition.service.ts`、`trends.service.ts`、`account-deletion.service.ts`、`submit-competition-lock-key.ts`
- Auth：`src/lib/auth-request.ts`（`requireTraineeSession` / `ForWrites`）
- Routes：`/api/training/sessions/**`
- Tests：`tests/integration/migrations/p2-training-trainee-id.test.ts`、`tests/integration/training/p2-training-subject.test.ts`、`tests/integration/api/p2-training-subject-routes.test.ts`

## Invariant coverage

| 类别 | 证据 |
|------|------|
| 迁移回填 | 隔离库：预置历史 session/projection → 0032 后 `trainee_id = student_id`；新旧索引并存；effective 唯一 23505 |
| 授权 | parent/student 可训；admin 403；跨主体 SESSION_NOT_FOUND |
| 隔离 | 同日同 key 双方均可 effective；家长无 outbox；学生 ledger/schedule/projection 不变；家长 projection `student_id` null / `adult` |
| 并发/幂等 | trainee 作用域 start/submit 唯一索引 + effective 日唯一；submit 竞争锁键改 traineeId |
| API | parent/student 无 owner body；student 非 adult；admin 拒绝 |

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/migrations/p2-training-trainee-id.test.ts tests/integration/training/p2-training-subject.test.ts tests/integration/api/p2-training-subject-routes.test.ts tests/integration/training/training.test.ts tests/integration/projection/rebuild-training-projection.test.ts` | exit 0 after migration assertion fix — 5 files / 18 tests passed（首轮 migration 唯一约束错误解包失败已修） |
| `pnpm test -- tests/integration/migrations/p2-training-trainee-id.test.ts` | exit 0 — 1 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — 0 errors（6 pre-existing warnings） |
| `pnpm format` | exit 0 after `prettier --write` on 3 files |
| `git diff --check` | exit 0 — clean |

## Not executed

- 全量 test / 全量 E2E / build / Docker / `pnpm dev`：指令禁止
- P3 家长训练 UI / runner 路由：范围外
- schema contract（删除 `student_id` / 旧索引）：范围外
- 既有本地库若 migration lineage 不兼容：本阶段以隔离库 migration 测试与共享库 `migrateTestDb` 验证；未改生产数据

## Risks / open review items

- 旧 `student_id` 唯一索引对 parent（`student_id` NULL）不构成约束；隔离依赖新 `trainee_id` 索引——符合 expand 设计
- 家长训练 audit 保留、outbox 跳过；若后续 worker 需家长事件须另开任务
- 临时 `studentId` facade 仍供既有测试/helper；新增入口已用 `TrainingSubject`
