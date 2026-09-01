# M6 P2 最终验收修正实施记录

> 修正基线：`e52ae4771561700384173d62f08c85123fe17ed8`
>
> 复验前置对象：`8b83c648df16ff30c57d5c11bde488ac4ab71ade`（NO-GO 审计后仅闭合 C01～C07）

## C01～C07 修正与测试映射

| 项 | 修正要点 | 主要文件 | 测试名称 |
|----|---------|---------|---------|
| C01 | `family-access` 仅撤销 relationship；grant 撤销归属 `reflection-privacy`；Data Lifecycle 同 tx 分别调用 | `family-access/account-deletion.service.ts`、`reflection-privacy/account-deletion.service.ts`、`deletion-request.service.ts` | `C01: account deletion revokes relationships and grants via separate module seams` |
| C02 | export status/download 与 deletion detail/cancel/confirm actor 矩阵；download 直接测 service | `export-job.service.ts`、`deletion-request.service.ts` | `C02: export status owner allowed and non-owner receives NOT_FOUND`；`C02: deliverExportDownload rejects non-owner without route pre-check`；`C02: parent export status rejects cross-student with NOT_FOUND`；`C02: deletion detail/cancel/confirm enforce student owner and admin boundaries` |
| C03 | 种入 schedule/training/reflection/ledger 并断言 section 字段与排除项 | `export-job.service.ts` | `C03: student export artifact contains seeded section field values and exclusions`；`C03: parent export includes granted private reflection and excludes without grant`；既有 `AC-M6-03: parent export excludes private reflection without grant`；`AC-M6-03: parent export excludes reflection after grant revoked at worker time`；`AC-M6-03: frozen student blocks export download` |
| C04 | 补齐 validateSession、relationship end、ledger 读、训练读/写、日程 complete、聚合 summary 读；cancel 恢复 | 各 module freeze guard + `freeze-matrix.test.ts` | `C04: freeze blocks validateSession for existing session`；`C04: freeze blocks relationship end command`；`C04: freeze blocks M3 ledger ledger read`；`C04: freeze blocks M5 training session read`；`C04: freeze blocks M5 training submit write`；`C04: freeze blocks M2 schedule complete write`；`C04: freeze blocks parent training summary aggregate read`；`F04: cancel restores previously frozen write access`；既有 P2-R01 / F04 用例 |
| C05 | 账户删除后人为恢复 canary，tombstone replay 经 module seam 再次清除 | `tombstone-replay.service.ts` | `C05: tombstone replay re-applies deletion after full canary restoration`；既有 `AC-M6-06: tombstone replay prevents body recovery after projection rebuild` |
| C06 | `processing → put → ready` 协议；并发 worker/下载；put/finalize 故障 fail-closed | `export-job.service.ts` | `C06: export job stays processing until artifact put completes`；`C06: concurrent export worker claims produce one ready artifact and token`；`C06: artifact put failure marks job failed without accessible download`；`C06: finalize failure after put purges artifact and marks job failed`；`C06: processing retry after interrupted worker completes ready state`；`C06: concurrent download consumes token once`；`C06: deletion worker concurrent execution converges to single executed state` |
| C07 | export 与 deletion 各自完整幂等矩阵（顺序/冲突/同 payload 并发/异 payload 并发） | `export-job.service.ts`、`deletion-request.service.ts` | export：`C07: export create replays same payload sequentially and conflicts on different payload`；`C07: export create concurrent same payload converges to one job`；`C07: export create concurrent different payload yields one success and one conflict`；deletion：`C07: deletion create replays same payload sequentially and conflicts on different payload`；`C07: deletion create concurrent same payload converges to one request`；`C07: deletion create concurrent different payload yields one success and one conflict` |

## 冻结矩阵（Route / Service / 测试）

| 模块 | Route / Service | 冻结 guard | 测试 |
|------|----------------|-----------|------|
| M1 身份/会话 | `login`、`validateSession` | `isStudentAccountNotFrozen` / session revoke | `C04: freeze blocks validateSession for existing session`；`F04: frozen student cannot re-login` |
| M1 关系写 | `endRelationship` | `assertStudentAccountNotFrozen` | `C04: freeze blocks relationship end command` |
| M2 日程读 | `queryScheduleItems` | service 层 | `P2-R01: freeze blocks M2 schedule read` |
| M2 日程写 | `createFormalPlan`、`completeScheduleItem` | service 层 | `F04: freeze blocks parent schedule write`；`C04: freeze blocks M2 schedule complete write` |
| M3 积分读 | `queryPointsBalance`、`queryPointsLedger` | service 层 | `P2-R01: freeze blocks M3 ledger read`；`C04: freeze blocks M3 ledger ledger read` |
| M3 积分写 | `enablePointRule` | service 层 | `F04: freeze blocks parent settlement write` |
| M4 总结读/写 | `getDailyReflection`、`upsertDailyReflection` | service 层 | `P2-R01: freeze blocks M4 reflection read`；`F04: cancel restores previously frozen write access` |
| M5 训练读 | `getTrainingSessionForStudent`、`queryTrainingTrends`、`getTrainingSummaryForParent` | service 层 | `C04: freeze blocks M5 training session read`；`F04: freeze blocks training trends read`；`C04: freeze blocks parent training summary aggregate read` |
| M5 训练写 | `startTrainingSession`、`submitTrainingSession` | service 层 | `P2-R01: freeze blocks M5 training write`；`C04: freeze blocks M5 training submit write` |
| M6 兑换读/写 | redemption catalog/redemption | service 层 | `P2-R01: freeze blocks M6 redemption read` |
| M6 导出 | export create/process/download | 创建/Worker/下载 + actor | `export-lifecycle`、`p2-remediation` C02/C03/C06 |
| M6 删除 | deletion CRUD/worker | 请求即 frozen + actor service | `deletion-lifecycle`、`p2-remediation` C02/C05/C07 |
| 撤销恢复 | `cancelDeletionRequest` 后 | guard 不再触发 | `F04: cancel restores previously frozen write access` |

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete
pnpm test tests/integration/data-lifecycle tests/integration/migrations tests/integration/api tests/integration/identity tests/integration/family-access tests/integration/reflection-privacy tests/integration/schedule tests/integration/training tests/integration/settlement tests/integration/projection tests/integration/redemption tests/integration/outbox tests/integration/audit
  → 48 files, 450 passed, 3 failed（~608s，串行 maxWorkers=1）
  失败项：tests/integration/training/m5-concurrency.test.ts（3 项；与 P2 无直接关联，维持 blocker 记录）
pnpm test tests/integration/data-lifecycle → 5 files, 55 passed
pnpm test tests/integration/training/m5-concurrency.test.ts → 15 passed, 3 failed（单独串行复跑，同上）
pnpm typecheck → exit 0
pnpm lint → exit 0（9 warnings，0 errors；含 pre-existing）
pnpm format → exit 0
```

## Blockers

- `m5-concurrency.test.ts` 3 项在串行全量与单独复跑中均失败（dual-session submit / idempotency dedupe / cleanup aggregate）；P2 专用 55 项 data-lifecycle 与 typecheck/format 均通过。需 Codex 判定是否为环境 flake 或独立跟进项。
