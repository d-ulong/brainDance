# M6 P2 实施记录：授权导出、账户级删除与 tombstone

## 需求映射

| 要求 | 实现要点 | 主要文件 | 测试证据 |
|------|---------|---------|---------|
| P2-R01 冻结/清除矩阵 | 统一 `assertStudentAccountNotFrozen`；Route/service 矩阵见下表 | `freeze-guard.service.ts`、M1–M6 接入点 | `freeze-matrix.test.ts` |
| P2-R02 导出与 artifact | `export_jobs`、scope snapshot、Worker、24h 一次性 token、`PrivateArtifactStore` | `export-job.service.ts`、`export-scope.service.ts`、`private-artifact-store.ts` | `export-lifecycle.test.ts` |
| P2-R03 删除/冻结/确认 | `deletion_requests`、即时冻结、30 天撤销、学生确认、管理员强制 | `deletion-request.service.ts` | `deletion-lifecycle.test.ts` |
| P2-R04 清除/tombstone | 版本化 7 步 Worker、`deletion_tombstones`、投影重建前重放 | `deletion-request.service.ts` | `deletion-lifecycle.test.ts`（tombstone replay） |

## 冻结矩阵（Route / Service / 测试）

| 模块 | Route / Service | 冻结 guard | 测试 |
|------|----------------|-----------|------|
| M1 身份/会话 | 删除请求撤销 session；`validateSession` epoch | `revokeStudentSessions`、`incrementStudentAuthorizationEpoch` | `deletion-lifecycle` 即时冻结 |
| M1 读 | `requireStudentReadAccess` | `assertStudentAccountNotFrozen` | `freeze-matrix` |
| M2 日程读 | `queryScheduleItems`、`queryCurrentFormalPlan` | service 层 | `freeze-matrix` M2 |
| M2 日程写 | `completeScheduleItem` | service 层 | `freeze-matrix`（间接） |
| M3 积分读 | `queryPointsBalance`、`queryPointsLedger` | service 层 | `freeze-matrix` M3 |
| M4 总结读/写 | `getDailyReflection`、`upsertDailyReflection` | service 层 | `freeze-matrix` M4、`deletion-lifecycle` |
| M5 训练读/写 | `getTrainingSessionForStudent`、`startTrainingSession` | service 层 | `freeze-matrix` M5 |
| M6 兑换读/写 | `listRedemptions`、`create/cancel/approve/reject`、`catalog` | service 层 | `freeze-matrix` M6 |
| M6 导出 | `POST /api/export-jobs`、`POST .../download` | 创建/Worker/下载二次校验 | `export-lifecycle.test.ts` |
| M6 删除 | `POST /api/deletion-requests`、`confirm`、`admin force` | 请求即 frozen | `deletion-lifecycle.test.ts` |

## 字段清除矩阵

| 表/字段 | 账户删除 | 独立总结删除 | 保留 |
|---------|---------|-------------|------|
| `users.display_name/email/phone/username` | 去标识（Deleted User / deleted_{requestId}） | 不变 | — |
| `users.status` | `disabled` | 不变 | — |
| `daily_reflections.body` | 清空 + deletedAt | 目标清空 | 无正文 audit 元数据 |
| `private_access_grants` | 关系级撤销（账户级 purge 步骤） | 目标 grant revoked | — |
| `training_events.payload` | `{}` | 不变 | session 结构键 |
| `point_ledger_entries.*` | 不删除 | 不删除 | 金额/来源类别 |
| `audit_events` | 无正文 action/reason | 无正文 | 完整性键 |
| `deletion_tombstones` | 写入 target | 写入 target | 可重放 payload（无 PII） |
| `export_jobs` / artifact | revoke + purge | 不涉及 | token 仅 hash |

## 导出证据

| 测试名称 | 覆盖 |
|---------|------|
| `AC-M6-03: student export scope includes all sections without body in snapshot` | scope 无正文 |
| `AC-M6-03: parent export excludes private reflection without grant` | grant 矩阵 |
| `AC-M6-03: parent export excludes reflection after grant revoked at worker time` | 撤权优先于 snapshot |
| `AC-M6-04: token stored as hash only; audit has no token plaintext` | 哈希存储/审计 |
| `AC-M6-04: concurrent download consumes token once` | 一次性消费 |
| `AC-M6-04: worker retry does not duplicate ready artifact` | Worker 幂等 |
| `AC-M6-03: frozen student blocks export download` | 冻结拒绝 |
| `AC-M6-03: ended relationship blocks parent export at scope build` | 关系解除 |

## 删除证据

| 测试名称 | 覆盖 |
|---------|------|
| `AC-M6-05: deletion request immediately freezes reads and writes` | 即时冻结 |
| `AC-M6-05: student can cancel within revocation window` | 30 天撤销 |
| `AC-M6-05: execution requires student confirmation` | 学生确认 |
| `AC-M6-06: executed deletion clears PII but retains ledger amounts` | 字段清除 |
| `AC-M6-06: repeat execution and dead replay are idempotent` | 重复执行幂等 |
| `AC-M6-06: tombstone replay prevents body recovery after projection rebuild` | tombstone 重放 |
| `AC-M6-05: independent daily reflection deletion purges only target` | 独立内容删除 |
| `AC-M6-05: admin force records audit without exposing body` | 管理员强制审计 |

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete (0026_m6_data_lifecycle applied)
pnpm test tests/integration/data-lifecycle → 3 files, 22 tests passed
pnpm test tests/integration/migrations tests/integration/data-lifecycle tests/integration/redemption tests/integration/api tests/integration/family-access tests/integration/reflection-privacy tests/integration/training tests/integration/schedule tests/integration/settlement tests/integration/projection tests/integration/outbox tests/integration/audit tests/integration/identity → 46 files, 45 passed, 1 failed (~587s, 串行)
  失败项：tests/integration/training/m5-concurrency.test.ts（2 个并发 advisory lock 观测超时；与 P2 冻结 guard 无直接关联）
pnpm typecheck → exit 0
pnpm lint → exit 0（仅 pre-existing + P2 新增 warnings，0 errors）
pnpm format → exit 0
```

## Blockers

- `m5-concurrency.test.ts` 2 项在串行全量验证中失败（advisory lock 观测超时）；P2 专用 22 项与 migration 约束均通过。需 Codex 判定是否为环境 flake 或需独立跟进。
