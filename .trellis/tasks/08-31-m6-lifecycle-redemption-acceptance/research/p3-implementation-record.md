# M6 P3 实施记录：UI、容量与恢复联合验收

> 执行基线：`961c5be3ab1b810024af193c7935da71eb749bd7`
>
> 已冻结：P1 `064842a74bee0d683f01334b5cce70a881ec4cbc`；P2 `761df5365e3f31fdb83d507c1cc1250751ed2cd0`
>
> P3 集中整改基线：`e0f588a742cff8b2f39e6f0b649495543fa67f4b`
> 被审 P3 提交：`90a347f108622e36798bd49e14adbdcae87959a6`
>
> P3 最终窄整改基线：`3840b272b6bd586e22947179b619742d2e07a230`
> 被审整改提交：`e5415d83899fbda4d7b1ef97672b78ffa5add0f6`（P3-C01～C04 已闭合）
>
> P3 最终测试整改基线：`30eb52f149dcc404bd133eba5f895c55bea62d4c`
> （`30eb52f` 已修复禁用“刷新状态”按钮导致的 E2E 超时；本轮仅补齐 F03/F04 精确覆盖）

## P3-C01～C06 整改映射

| 项 | 要点 | 主要文件 |
|----|------|---------|
| P3-C01 | 删除浏览器 `/process` Route；独立 `lifecycle-worker` 领取 `export.requested`；UI 仅创建/轮询/下载；**状态不再揭示一次性下载令牌，token 由授权命令按需签发（F01）** | 删除 `process/route.ts`；`scripts/lifecycle-worker.mts`；`m6-outbox-handlers.ts`；导出 UI；`m6-export-worker-boundary.test.ts`；E2E process 404 |
| P3-C02 | 持久私有 filesystem artifact adapter；显式绝对根目录；原子写入；内存仅测试 | `private-artifact-store.ts`；`route-artifact-stores.ts`；`private-artifact-store.test.ts` |
| P3-C03 | 容量输出 connections/queue/slowQueries/export/deletion/resources；不可测用 `unavailable+reason` | `capacity-synthetic.mts`；`scripts/lib/capacity-metrics.ts`；`capacity-metrics.test.ts` |
| P3-C04 | 隔离库 `CREATE DATABASE ... TEMPLATE` 快照恢复；restore 后 tombstone replay → rebuild；完整 canary | `recovery-drill.mts` |
| P3-C05 | 备份水位 + 故意 post-backup 写入计算观测 RPO；分阶段 RTO | `recovery-drill.mts` 输出 `rpo`/`rto` |
| P3-C06 | 双视口 UI 主路径与错误路径；API helper 仅夹具；**冻结后不得重新登录，撤销/确认走仅限删除管理的窄 capability（F02）** | `m6-lifecycle-flow.spec.ts`；`m6-lifecycle-helpers.ts`；`login.service.ts` |

## P3-F01～F05 最终窄整改映射

| 项 | 要点 | 主要文件 | 测试名称 |
|----|------|---------|---------|
| P3-F01 | 消除 READY 与 token 交付崩溃窗口：Worker 只写 artifact 并置 READY；明文 token 绝不落库/artifact，由授权签发命令按需生成并只存 hash、轮换可安全重试；一次性、24h、二次授权 | `export-job.service.ts`；`download/route.ts`；新增 `[jobId]/token/route.ts`；`m6-api.ts`；学生/家长导出页 | `F01: READY job is always recoverable via on-demand token issuance`；`F01: interrupted processing ... converges on replay`；`F01: no plaintext token is persisted...`；`F01: concurrent issuance is safe...`；`F01: issuance is authorization-gated...`；`F01: frozen student cannot issue a download token`；`AC-M6-04: token stored as hash only...` |
| P3-F02 | 恢复冻结学生登录/通用 session fail-closed；删除撤销/确认走仅限这些动作的窄 capability（仅状态/撤销/确认，20 分钟、hash 存储、绑定单一删除请求） | `login.service.ts`；`freeze-guard.service.ts`；新增 `deletion-capability.service.ts`；新增 `deletion_capabilities` 表与迁移 0027；删除 routes（GET/DELETE/confirm/capability）；`account-deletion/page.tsx` | `F02: frozen student cannot re-login or validate a generic session`；`F02: narrow deletion capability allows cancel but grants no ordinary access`；`F02: capability is bound to its deletion request...`；`F02: capability cannot be reused after the request leaves frozen`；`F02: capability authorizes student confirm...`；`F02: capability expires and validation fails after TTL` |
| P3-F03 | 终态冲突 E2E 必须真正触发并断言：双页面 stale pending 视图产生真实 STATE_CONFLICT，UI 明确反馈；无条件跳过 | `m6-lifecycle-flow.spec.ts` | `AC-M6-09 parent reject + terminal conflict via UI` |
| P3-F04 | 补齐家长导出 UI 双视口：授权学生创建/轮询/token 获取/下载与失败反馈；无权学生不泄露 | `m6-lifecycle-flow.spec.ts`；`m6-lifecycle-helpers.ts` | `AC-M6-09 parent export create/poll/download via UI`；`AC-M6-09 parent export does not leak unrelated student data` |
| P3-F05 | `totalRtoMs` 从恢复/restore 启动点计时，覆盖 restore → replay → rebuild → canary；不含夹具准备与备份创建；输出各阶段与总 RTO | `recovery-drill.mts` | 恢复演练输出 `rto.restoreMs/replayMs/rebuildMs/canaryMs/totalRtoMs` |

## AC-M6-01～10

| AC | 证据 | 本阶段结果 |
|----|------|-----------|
| AC-M6-01～02 | P1 签署 GO | 继承通过；本阶段未改写领域行为 |
| AC-M6-03～06 | P2 签署 GO | 继承通过；未削弱冻结/tombstone/一次性 token |
| AC-M6-07 | 隔离 TEMPLATE 快照恢复 + tombstone 先于 rebuild + 完整 canary + 观测 RPO/RTO | **通过（隔离合成演练）** |
| AC-M6-08 | 三档脚本可执行；指标字段完整；仅实测档记通过 | **tier 100 通过**；1k/10k **deferred**；slowQueries 本机 `unavailable`（无 pg_stat_statements） |
| AC-M6-09 | desktop + mobile-360 UI 交互；夹具与 UI 断言已区分 | **聚焦通过**：`30eb52f` 后 desktop-chromium **10 passed**；本轮 F03/F04 精确覆盖后 desktop/mobile 各 **11 passed**。全量 `pnpm test:e2e` 仍无最终通过结果 |
| AC-M6-10 | migration / test / typecheck / lint / format / build / e2e | 见下方原始摘要 |

## 夹具 vs UI 断言（P3-C06）

| 用途 | 允许方式 |
|------|----------|
| 夹具 | `createThrowawayStudentViaApi`、`expireExportJobTokenFixture`、`loginViaApi`（仅登录会话）；`createExportViaUi`/`createParentExportViaUi` 从创建响应取 jobId（点击仍走 UI） |
| UI 断言 | 兑换申请/撤销、目录创建、批准/拒绝、学生/家长导出创建/轮询/下载、删除请求/撤销/确认、删除管理窄 capability 认证、冻结登录拒绝、越权不泄露、终态冲突双页面、过期 token 下载失败、process 404 |

身份边界修正（F02）：冻结学生不得重新登录或获得通用 session（P2 契约恢复 fail-closed）；删除撤销/确认经窄 capability（仅删除管理路由，20 分钟、hash 存储、绑定单一删除请求）。创建删除时仍撤销既有 session 并提升 authorizationEpoch。

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
- **RTO 语义（F05）**：`totalRtoMs` 从恢复/restore 启动点开始，覆盖 restore → tombstone/撤权重放 → 投影重建 → canary；**不含夹具准备与备份创建**。分阶段输出 `restoreMs` / `replayMs` / `rebuildMs` / `canaryMs` / `totalRtoMs`（量级：restore≈512ms / replay≈62ms / rebuild≈13ms / canary≈数十 ms / total≈1s 内）
- canary：已删正文不可读、已撤授权仍撤销、未删授权矩阵完整、余额与兑换历史一致、未删正文/身份完整、RPO marker 丢失 → **passed: true**

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete（含 0027_m6_deletion_capabilities；跳库重复物/截断提示仅 NOTICE）
pnpm typecheck → exit 0（两次）
pnpm lint → exit 0（6 warnings，0 errors；m5-training-flow 等既有未用变量告警）
pnpm format:write → 定向于本阶段改动文件（含新增未跟踪文件），拒绝全仓 --write；随后定向 prettier --check → All matched files use Prettier code style
pnpm build → exit 0（无 /process Route）
pnpm test → 全量两次运行均超时（约 5 分 24 秒 / 5 分 36 秒无最终结果，手动中止，含 --exclude m5-concurrency 的第二次仍无结果）；聚焦/相关集成测试已通过（见下）
  聚焦通过：
    tests/integration/data-lifecycle/f01-token-issuance.test.ts           6 通过（F01 全部）
    tests/integration/data-lifecycle/f02-deletion-capability.test.ts      6 通过（F02 全部；含错误密码修正断言）
    tests/integration/data-lifecycle/freeze-matrix.test.ts               通过（F02 fail-closed + capability 两条新用例）
    tests/integration/data-lifecycle/export-lifecycle.test.ts            通过（AC-M6-04 no-plaintext 等）
    tests/integration/data-lifecycle/p2-remediation.test.ts              通过（C06 并发 worker/token 语义更新）
    tests/integration/api/m6-export-worker-boundary.test.ts              2 通过（C01：status 不揭示 token + 授权签发）
    tests/integration/migrations/m6/m2/m3-schema-constraints.test.ts     29 通过（journal head=0027）
pnpm test:e2e → 全量长时间无最终结果已中止（blocker 未关闭）。
P3 最终测试整改（基线 30eb52f）聚焦证据：
  30eb52f 验证：desktop-chromium 聚焦 M6 lifecycle → 10 passed（修复禁用刷新按钮超时后）。
  本轮命令（各只跑一次；独立 lifecycle worker）：
    pnpm exec playwright test tests/e2e/m6-lifecycle-flow.spec.ts --project=desktop-chromium
      → exit 0；11 passed / 0 failed（含 F03 终态冲突精确断言 + F04 家长过期 token 失败 UI）
    pnpm exec playwright test tests/e2e/m6-lifecycle-flow.spec.ts --project=mobile-360
      → exit 0；11 passed / 0 failed
BRAIN_DANCE_SYNTHETIC=1 pnpm capacity:synthetic -- --tier 100 → passed（见上；本阶段实测 export ≈19 jobs/s、deletion ≈10.6 jobs/s）
BRAIN_DANCE_SYNTHETIC=1 pnpm recovery:drill → passed: true（两轮；第二轮阶段计时实测）
```

## P3 最终测试整改（F03/F04）

| 项 | 要点 | 证据 |
|----|------|------|
| 前置 | `30eb52f` 修复 `waitForExportReady` 对禁用“刷新状态”按钮直接 `click()` 导致的 E2E 超时 | 聚焦 desktop **10 passed** |
| F03 | 双页面陈旧 pending redemption：断言 HTTP `409`、`STATE_CONFLICT`、以及 `parent-redemption-error` 含语义明确的 `not pending` 冲突反馈（不得只断言任意错误区可见） | `AC-M6-09 parent reject + terminal conflict via UI` |
| F04 | 家长 UI 创建导出 → ready → fixture 使 token 失效 → 点击下载；断言 token 接口失败与 `TOKEN_EXPIRED`，且 `parent-export-error` 显示明确失败反馈 | `AC-M6-09 expired parent export token fails via UI after fixture expiry` |
| 范围 | 仅 E2E 与实施记录；未改 `src/` / schema / migration / 业务实现 | — |
| 全量 | `pnpm test` 与全量 `pnpm test:e2e` **仍无最终通过结果**；blocker **未关闭** | 见 Blockers |

## 监控与回滚说明

- 监控：export job status/ready/failed；deletion frozen/executed；outbox pending/dead；artifact purge；recovery canary 失败；Worker 停领。
- 回滚：停止新兑换/导出/删除入口；Worker 停领；不得回滚 tombstone 或恢复已清正文。

## Blockers / deferred

- **blocker（沿用）**：`m5-concurrency.test.ts` 3 项失败（未重跑确认；全量超时无法给出失败清单）。
- **blocker（本阶段/环境）**：`pnpm test` 全量两次超时无最终结果（约 5m24s / 5m36s 手动中止；第二次含 `--exclude m5-concurrency` 仍无结果）。聚焦/相关测试均通过，排除已知并发用例后的全量未能完成。
- **blocker（本阶段/环境）**：全量 `pnpm test:e2e` 长时间无最终结果已中止（**未关闭**）。聚焦 M6 lifecycle E2E 已有通过证据：`30eb52f` desktop **10 passed**；本轮 F03/F04 精确覆盖后 desktop/mobile 各 **11 passed**。全量 E2E 仍无最终通过结果。
- **deferred**：容量档 1,000 / 10,000 未在本机实测。
- **deferred/环境**：slowQueries 因本机未安装 `pg_stat_statements` 记为 unavailable（非伪造 null）。
- **上线 blocker（规格冻结）**：供应商、DPA、数据驻留、生产密钥、真实生产备份/演练、法律期限。
