# M6 P3 实施记录：UI、容量与恢复联合验收

> 执行基线：`961c5be3ab1b810024af193c7935da71eb749bd7`
>
> 已冻结：P1 `064842a74bee0d683f01334b5cce70a881ec4cbc`；P2 `761df5365e3f31fdb83d507c1cc1250751ed2cd0`

## P3-R01～R04 交付映射

| 项 | 要点 | 主要文件 |
|----|------|---------|
| P3-R01 | 学生兑换/撤销、家长目录/审批、导出状态/下载、删除危险确认 UI；写操作 `Idempotency-Key`；状态文案不单靠颜色 | `src/lib/client/m6-api.ts`；`src/app/student/redemption`；`src/app/student/export`；`src/app/student/account-deletion`；`src/app/parent/students/[studentId]/redemption`；`src/app/parent/students/[studentId]/export`；导航 `src/app/page.tsx`、`src/app/parent/students/page.tsx` |
| P3-R01 E2E | desktop Chromium + mobile-360；主路径、越权、终态冲突、已消费/无效 token、冻结、危险确认、无横向滚动 | `tests/e2e/m6-lifecycle-flow.spec.ts`；`tests/e2e/m6-lifecycle-helpers.ts`；`scripts/e2e-bootstrap.ts`（种子余额+目录） |
| P3-R01 导出处理 | 请求方触发 `processExportJob`，与 download 共用内存 artifact store（不改 P1/P2 领域契约） | `src/app/api/export-jobs/[jobId]/process/route.ts`；`src/modules/data-lifecycle/route-artifact-stores.ts` |
| P3-R02 | 100/1k/10k 可选档；隔离临时库；`BRAIN_DANCE_SYNTHETIC=1` fail-closed | `scripts/capacity-synthetic.mts`；`scripts/lib/synthetic-env-guard.ts`；`package.json` `capacity:synthetic` |
| P3-R03 | 隔离恢复：删除/tombstone → 模拟备份泄漏 → tombstone 先于投影重建 → canary | `scripts/recovery-drill.mts`；`package.json` `recovery:drill` |
| P3-R04 | 本文件；AC-M6-01～10 与 blockers/deferred | 本记录 |

## AC-M6-01～10

| AC | 证据 | 本阶段结果 |
|----|------|-----------|
| AC-M6-01～02 | P1 签署 GO | 继承通过；本阶段未改写领域行为 |
| AC-M6-03～06 | P2 签署 GO | 继承通过；本阶段未改写冻结/tombstone/令牌契约 |
| AC-M6-07 | `BRAIN_DANCE_SYNTHETIC=1 pnpm recovery:drill` → `passed: true`；tombstone replay 先于 rebuild；正文不可读 | **通过（隔离合成演练）** |
| AC-M6-08 | 三档脚本可执行；仅实际运行记通过 | **tier 100 通过**；1k/10k **deferred** |
| AC-M6-09 | `pnpm test:e2e` 含 m6 双视口；无横向滚动断言 | **通过（60/60）** |
| AC-M6-10 | migration / test / typecheck / lint / format / build / e2e | 见下方原始摘要 |

## 容量结果（实际执行）

命令：

```bash
BRAIN_DANCE_SYNTHETIC=1 pnpm capacity:synthetic -- --tier 100
```

摘要（隔离库 `bd_synth_capacity_100_mtid1ott`）：

- families seeded: 100，seed ~24.7s
- connections: before=1，afterSeed=1
- queueDepth.pending: 300
- export sample 10 ready，~20.1 jobs/s，~497ms
- deletionThroughputPerSec: null（本档未测删除吞吐）
- 非生产容量保证

未执行：`--tier 1000`、`--tier 10000` → **deferred**。

## 恢复结果（实际执行）

命令：

```bash
BRAIN_DANCE_SYNTHETIC=1 pnpm recovery:drill
```

摘要（隔离库 `bd_synth_recovery_mtid1j8x`）：

- rtoMs ≈ 3019.6（本地合成；非生产 RTO/RPO 承诺）
- replayMs ≈ 32.9；rebuildMs ≈ 5.0
- steps：tombstone → replay → rebuild → canary body blocked → deleted balance cleared → survivor identity intact → **passed: true**

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete
pnpm test → 71 files；580 passed，3 failed（~630s）
  失败：tests/integration/training/m5-concurrency.test.ts（3 项；与 P3 无直接关联，沿用 P2 blocker）
pnpm typecheck → 构建后可过（曾因 .next/types 暂缺出现 TS6053，以 `pnpm build` 后 typecheck 为准）
pnpm lint → exit 0（9 warnings，0 errors；含 pre-existing）
pnpm format → exit 0（prettier --write 后）
pnpm build → exit 0（含于 test:e2e supervisor）
pnpm test:e2e → 60 passed（desktop + mobile-360，~6.0m）
pnpm exec playwright test tests/e2e/m6-lifecycle-flow.spec.ts → 14 passed
BRAIN_DANCE_SYNTHETIC=1 pnpm capacity:synthetic -- --tier 100 → passed（见上）
BRAIN_DANCE_SYNTHETIC=1 pnpm recovery:drill → passed: true
```

## 监控与回滚说明

- 监控：export job status/ready/failed；deletion frozen/executed；outbox pending/dead；artifact purge pending keys；恢复演练 canary 失败。
- 回滚：停止新兑换/导出/删除请求入口；Worker 停领；不得回滚 tombstone 或恢复已清正文；已批准负向 ledger 不删除。

## Blockers / deferred（上线前不得因本阶段关闭）

- **blocker（沿用）**：`m5-concurrency.test.ts` 3 项失败。
- **deferred**：容量档 1,000 / 10,000 未在本机实际跑完。
- **上线 blocker（规格冻结）**：供应商、DPA、数据驻留、生产密钥、真实生产备份/演练、法律期限。
- **deferred**：生产级删除吞吐测量；生产对象存储 provider ADR。
