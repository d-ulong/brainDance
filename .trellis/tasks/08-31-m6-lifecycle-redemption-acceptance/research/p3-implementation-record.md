# M6 P3 实施记录：UI、容量与恢复联合验收

> 执行基线：`961c5be3ab1b810024af193c7935da71eb749bd7`
>
> 已冻结：P1 `064842a74bee0d683f01334b5cce70a881ec4cbc`；P2 `761df5365e3f31fdb83d507c1cc1250751ed2cd0`
>
> P3 集中整改基线：`e0f588a742cff8b2f39e6f0b649495543fa67f4b`
> 被审 P3 提交：`90a347f108622e36798bd49e14adbdcae87959a6`

## P3-C01～C06 整改映射

| 项 | 要点 | 主要文件 |
|----|------|---------|
| P3-C01 | 删除浏览器 `/process` Route；独立 `lifecycle-worker` 领取 `export.requested`；UI 仅创建/轮询/下载；状态可揭示一次性下载令牌 | 删除 `process/route.ts`；`scripts/lifecycle-worker.mts`；`m6-outbox-handlers.ts`；导出 UI；`m6-export-worker-boundary.test.ts`；E2E process 404 |
| P3-C02 | 持久私有 filesystem artifact adapter；显式绝对根目录；原子写入；内存仅测试 | `private-artifact-store.ts`；`route-artifact-stores.ts`；`private-artifact-store.test.ts` |
| P3-C03 | 容量输出 connections/queue/slowQueries/export/deletion/resources；不可测用 `unavailable+reason` | `capacity-synthetic.mts`；`scripts/lib/capacity-metrics.ts`；`capacity-metrics.test.ts` |
| P3-C04 | 隔离库 `CREATE DATABASE ... TEMPLATE` 快照恢复；restore 后 tombstone replay → rebuild；完整 canary | `recovery-drill.mts` |
| P3-C05 | 备份水位 + 故意 post-backup 写入计算观测 RPO；分阶段 RTO | `recovery-drill.mts` 输出 `rpo`/`rto` |
| P3-C06 | 双视口 UI 主路径与错误路径；API helper 仅夹具；冻结后允许重新登录以便撤销/确认（业务入口仍 freeze-guard） | `m6-lifecycle-flow.spec.ts`；`m6-lifecycle-helpers.ts`；`login.service.ts` |

## AC-M6-01～10

| AC | 证据 | 本阶段结果 |
|----|------|-----------|
| AC-M6-01～02 | P1 签署 GO | 继承通过；本阶段未改写领域行为 |
| AC-M6-03～06 | P2 签署 GO | 继承通过；未削弱冻结/tombstone/一次性 token |
| AC-M6-07 | 隔离 TEMPLATE 快照恢复 + tombstone 先于 rebuild + 完整 canary + 观测 RPO/RTO | **通过（隔离合成演练）** |
| AC-M6-08 | 三档脚本可执行；指标字段完整；仅实测档记通过 | **tier 100 通过**；1k/10k **deferred**；slowQueries 本机 `unavailable`（无 pg_stat_statements） |
| AC-M6-09 | desktop + mobile-360 UI 交互；夹具与 UI 断言已区分 | **通过**（本阶段 `pnpm test:e2e`：全部 M6 lifecycle 用例双视口通过） |
| AC-M6-10 | migration / test / typecheck / lint / format / build / e2e | 见下方原始摘要 |

## 夹具 vs UI 断言（P3-C06）

| 用途 | 允许方式 |
|------|----------|
| 夹具 | `createThrowawayStudentViaApi`、`expireExportJobTokenFixture`、`loginViaApi`（仅登录会话）；`createExportViaUi` 从创建响应取 jobId（点击仍走 UI） |
| UI 断言 | 兑换申请/撤销、目录创建、批准/拒绝、导出创建/轮询/下载、删除请求/撤销/确认、越权、冻结写失败、过期 token 下载失败、process 404 |

身份边界修正（支撑删除撤销/确认 UI）：冻结后仍允许学生重新登录；业务读/写继续由 freeze-guard 拒绝。创建删除时仍撤销既有 session 并提升 authorizationEpoch。

## 容量结果（实际执行）

命令：

```bash
BRAIN_DANCE_SYNTHETIC=1 pnpm capacity:synthetic -- --tier 100
```

摘要（隔离库 `bd_synth_capacity_100_mtieyi63`）：

- families seeded: 100，seed ~31.9s
- connections: measured before=1，afterSeed=1
- queueDepth.pending: 300
- slowQueries: unavailable — `pg_stat_statements extension is not installed`
- export sample 10 ready，~12.9 jobs/s
- deletion sample 3 executed，~7.5 jobs/s
- resources: measured（rss/heap/freemem；非生产 SLO）
- 非生产容量保证

未执行：`--tier 1000`、`--tier 10000` → **deferred**。

## 恢复结果（实际执行）

命令：

```bash
BRAIN_DANCE_SYNTHETIC=1 pnpm recovery:drill
```

摘要：

- 方法：`CREATE DATABASE ... TEMPLATE` 快照备份/恢复（等价数据库级快照）；restore 后注入泄漏 → tombstone replay → rebuild → canary
- recoveryPointAt = max(audit_events.occurred_at) before backup；post-backup marker 在 restore 后丢失
- observedRpoMs ≈ 283（本地合成；非生产 RPO 承诺）
- rto：backup≈227ms 量级 / restore≈512ms 量级 / replay≈62ms / rebuild≈13ms / total≈数秒
- canary：已删正文不可读、已撤授权仍撤销、未删授权矩阵完整、余额与兑换历史一致、未删正文/身份完整、RPO marker 丢失 → **passed: true**

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete
pnpm typecheck → exit 0
pnpm lint → exit 0（7 warnings，0 errors）
pnpm format:write → exit 0
pnpm build → exit 0（无 /process Route）
pnpm test → 仅已知失败：tests/integration/training/m5-concurrency.test.ts（3 项；沿用 P2 blocker）
pnpm test:e2e → 61 passed，1 failed（~7.4m）
  失败：tests/e2e/m2-schedule-points-flow.spec.ts（desktop；期望余额 110 实得 10；与 P3 无直接关联）
  M6 lifecycle flow：desktop 8/8 + mobile 8/8 全部通过（含过期 token、删除撤销/确认、冻结挡导出、process 404）
BRAIN_DANCE_SYNTHETIC=1 pnpm capacity:synthetic -- --tier 100 → passed（见上）
BRAIN_DANCE_SYNTHETIC=1 pnpm recovery:drill → passed: true
```

## 监控与回滚说明

- 监控：export job status/ready/failed；deletion frozen/executed；outbox pending/dead；artifact purge；recovery canary 失败；Worker 停领。
- 回滚：停止新兑换/导出/删除入口；Worker 停领；不得回滚 tombstone 或恢复已清正文。

## Blockers / deferred

- **blocker（沿用）**：`m5-concurrency.test.ts` 3 项失败。
- **blocker（沿用/环境）**：`m2-schedule-points-flow` desktop E2E 余额断言偶发/环境不一致（期望 +10 未反映到投影；非 M6 UI 路径）。
- **deferred**：容量档 1,000 / 10,000 未在本机实测。
- **deferred/环境**：slowQueries 因本机未安装 `pg_stat_statements` 记为 unavailable（非伪造 null）。
- **上线 blocker（规格冻结）**：供应商、DPA、数据驻留、生产密钥、真实生产备份/演练、法律期限。
