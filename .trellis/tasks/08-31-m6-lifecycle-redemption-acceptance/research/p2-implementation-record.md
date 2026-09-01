# M6 P2 实施记录：授权导出、账户级删除与 tombstone

## 需求映射

| 要求 | 实现要点 | 主要文件 | 测试证据 |
|------|---------|---------|---------|
| P2-R01 冻结/清除矩阵 | 统一 `assertStudentAccountNotFrozen`；login/趋势/计划/结算/关系等扩展 guard | `freeze-guard.service.ts`、M1–M6 接入点 | `freeze-matrix.test.ts` |
| P2-R02 导出与 artifact | commit 后 `put`、失败补偿 `failed`+purge；advisory lock 幂等创建 | `export-job.service.ts`、`private-artifact-store.ts` | `export-lifecycle.test.ts`、`p2-remediation.test.ts` F06/F07 |
| P2-R03 删除/冻结/确认 | 模块 seam 编排；外部 artifact purge 在 tx 后 | `deletion-request.service.ts`、各 `account-deletion.service.ts` | `deletion-lifecycle.test.ts` |
| P2-R04 清除/tombstone | 关系/grant/训练 payload 清除；tombstone 重放调用 module seam | `tombstone-replay.service.ts` | `p2-remediation.test.ts` F05 |

## P2 集中整改映射（F01～F07）

| 项 | 整改 | 主要文件 | 测试 |
|----|------|---------|------|
| F01 跨模块直接写权威表 | Identity/Schedule/Training/Reflection/Family/Projection 暴露 `tx` seam；Data Lifecycle 只编排 | `*/account-deletion.service.ts`、`deletion-request.service.ts` | `p2-remediation.test.ts` F05 |
| F02 资源级授权在 service | `getExportJobStatusForActor`、`deliverExportDownload` actor 校验、`getDeletionRequestForActor` | `export-job.service.ts`、download/deletion Route | `p2-remediation.test.ts` F02 |
| F03 导出 artifact 缺 section | `buildExportArtifactContent` 生成 schedule/training_summary（无 payload 正文） | `export-job.service.ts` | `p2-remediation.test.ts` F03 |
| F04 冻结矩阵不全 | login/validateSession、趋势、计划、结算、关系结束等 guard；矩阵扩展 | 各 module service + `login.service.ts` | `freeze-matrix.test.ts` F04 用例 |
| F05 清除/tombstone 不完整 | 账户删除撤销关系/grant、purge training payload；tombstone 重放全 seam | `tombstone-replay.service.ts` | `p2-remediation.test.ts` F05 |
| F06 artifact/Worker 并发语义 | DB commit 后 put；失败 mark failed；双连接 worker 并发 | `export-job.service.ts`、`freeze-guard.service.ts` | `p2-remediation.test.ts` F06 |
| F07 创建幂等 payload | hash 比对 + `onConflictDoNothing` + advisory lock + unique 重选 | `export-job.service.ts`、`deletion-request.service.ts` | `p2-remediation.test.ts` F07 |

## 冻结矩阵（Route / Service / 测试）

| 模块 | Route / Service | 冻结 guard | 测试 |
|------|----------------|-----------|------|
| M1 身份/会话 | `login`、`validateSession` | `isStudentAccountNotFrozen` | `freeze-matrix` F04 重登录 |
| M1 读 | `requireStudentReadAccess` | `assertStudentAccountNotFrozen` | `freeze-matrix` |
| M2 日程读 | `queryScheduleItems`、`queryCurrentFormalPlan` | service 层 | `freeze-matrix` M2 |
| M2 日程写 | `completeScheduleItem`、`skipScheduleItem`、`createFormalPlan` | service 层 | `freeze-matrix` F04 计划写 |
| M3 积分读 | `queryPointsBalance`、`queryPointsLedger` | service 层 | `freeze-matrix` M3 |
| M3 积分写 | `enablePointRule` | service 层 | `freeze-matrix` F04 结算写 |
| M4 总结读/写 | `getDailyReflection`、`upsertDailyReflection` | service 层 | `freeze-matrix` M4、`deletion-lifecycle` |
| M5 训练读 | `getTrainingSessionForStudent`、`queryTrainingTrends`、`getTrainingSummaryForParent` | service 层 | `freeze-matrix` F04 趋势 |
| M5 训练写 | `startTrainingSession`、`submitTrainingSession` | service 层 | `freeze-matrix` M5 |
| M6 兑换读/写 | redemption catalog/redemption | service 层 | `freeze-matrix` M6 |
| M6 导出 | export create/process/download | 创建/Worker/下载二次校验 + actor | `export-lifecycle`、`p2-remediation` F02/F06 |
| M6 删除 | deletion CRUD/worker | 请求即 frozen + actor service | `deletion-lifecycle`、`p2-remediation` |
| M4 关系写 | `endRelationship` | 冻结 student scope | `p2-remediation` F05（关系撤销） |
| 撤销恢复 | `cancelDeletionRequest` 后 | guard 不再触发 | `freeze-matrix` F04 cancel restore |

## 字段清除矩阵

| 表/字段 | 账户删除 | 独立总结删除 | 保留 | tombstone 重放 |
|---------|---------|-------------|------|---------------|
| `users.display_name/email/phone/username` | 去标识（Deleted User / deleted_{requestId}） | 不变 | — | Identity seam |
| `users.status` | `disabled` | 不变 | — | Identity seam |
| `sessions` | 删除 | 不变 | — | Identity seam |
| `relationships.status` | `ended` | 不变 | — | Family-access seam |
| `private_access_grants.revoked_at` | 全部撤销 | 目标 grant revoked | — | Reflection seam |
| `daily_reflections.body` | 清空 + deletedAt | 目标清空 | 无正文 audit | Reflection seam |
| `training_events.payload` | `{}` | 不变 | session 结构键 | Training seam |
| `schedule_items.status` (pending) | `cancelled` | 不变 | — | Schedule seam |
| `training_profile_projection` | 删除并重建 | 不变 | — | Projection seam |
| `point_balance_projection` | 重建 | 不变 | 金额投影 | Projection seam |
| `point_ledger_entries.*` | 不删除 | 不删除 | 金额/来源类别 | — |
| `audit_events` | 无正文 action/reason | 无正文 | 完整性键 | — |
| `deletion_tombstones` | 写入 target | 写入 target | 无 PII payload | — |
| `export_jobs` / artifact | revoke + 外部 purge | 不涉及 | token 仅 hash | — |

## 导出证据

| 测试名称 | 覆盖 |
|---------|------|
| `AC-M6-03: student export scope includes all sections without body in snapshot` | scope 无正文 |
| `F03: student export artifact includes schedule and training_summary sections` | artifact section 内容 |
| `AC-M6-03: parent export excludes private reflection without grant` | grant 矩阵 |
| `AC-M6-04: concurrent download consumes token once` | 一次性消费 |
| `F06: concurrent export worker claims produce one ready artifact` | 双连接 worker |
| `F06: artifact put failure marks job failed without accessible artifact` | put 故障注入 |
| `F07: export create replays same payload and conflicts on different payload` | 幂等 hash |

## 删除证据

| 测试名称 | 覆盖 |
|---------|------|
| `AC-M6-05: deletion request immediately freezes reads and writes` | 即时冻结 |
| `AC-M6-06: executed deletion clears PII but retains ledger amounts` | 字段清除 |
| `AC-M6-06: tombstone replay prevents body recovery after projection rebuild` | tombstone 重放 |
| `F05: account deletion revokes relationships and purges training payloads` | 关系/grant/训练 payload |
| `F07: deletion create concurrent same payload converges to one request` | 并发幂等 |
| `F02: deletion request detail rejects cross-student with NOT_FOUND shape` | actor 授权 |

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete
pnpm test tests/integration/data-lifecycle tests/integration/migrations tests/integration/api tests/integration/identity tests/integration/family-access tests/integration/reflection-privacy tests/integration/schedule tests/integration/training tests/integration/settlement tests/integration/projection tests/integration/redemption tests/integration/outbox tests/integration/audit → 47 files, 430 passed, 3 failed (~709s, 串行)
  失败项：tests/integration/training/m5-concurrency.test.ts（3 项 advisory lock / cleanup 观测；与 P2 冻结 guard 无直接关联）
pnpm test tests/integration/data-lifecycle → 4 files, 37 tests passed
pnpm test tests/integration/training/m5-concurrency.test.ts → 15 passed, 3 failed（单独串行复跑，同上）
pnpm typecheck → exit 0
pnpm lint → exit 0（pre-existing + P2 warnings，0 errors）
pnpm format → exit 0（prettier --write 后通过）
```

## Blockers

- `m5-concurrency.test.ts` 3 项在串行全量与单独复跑中均失败（cleanup aggregate / advisory lock 观测）；P2 专用 37 项与 migration 约束均通过。需 Codex 判定是否为环境 flake 或需独立跟进。
