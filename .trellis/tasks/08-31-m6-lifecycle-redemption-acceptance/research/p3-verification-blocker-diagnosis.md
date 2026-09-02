# P3 验证阻断只读诊断

> 供 Codex 审核后决定下一步。本文件为唯一允许新增的诊断记录；未改代码、配置、任务状态、签署或实施记录。

## 固定范围

| 项 | 值 |
|----|-----|
| Active task | `.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance` |
| 分支 | `feat/m6-lifecycle-redemption-acceptance` |
| 固定审核 SHA / HEAD | `a59cd32b3df11d9b18ca4201a04cee0e480cb586` |
| 诊断执行日 | 2026-09-02（只读；未跑全量 `pnpm test` / `pnpm test:e2e`） |

**未修改范围声明（写本文件前 `git status --short`）：**

- `M AGENTS.md` — Codex 未提交修改，**禁止**改动/暂存/提交。
- 未跟踪 archive 日志（禁止改动/暂存/提交）：
  - `.trellis/tasks/archive/2026-08/08-25-m1-verification-remediation/research/e2e-run1.log`
  - `.trellis/tasks/archive/2026-08/08-25-m1-verification-remediation/research/e2e-run2.log`
  - `.trellis/tasks/archive/2026-08/08-25-m1-verification-remediation/research/e2e-supervised-run1.log`
  - `.trellis/tasks/archive/2026-08/08-25-m1-verification-remediation/research/e2e-supervised-run2.log`
- 除本文件外，未修改任何现有代码、测试、配置、任务状态、签署或 `p3-implementation-record.md`。

**核对命令证据：** `git rev-parse --abbrev-ref HEAD` → `feat/m6-lifecycle-redemption-acceptance`；`git rev-parse HEAD` → `a59cd32b3df11d9b18ca4201a04cee0e480cb586`。

---

## 已确认事实

### 历史全量 Vitest / E2E 原始症状

来源：`research/p3-implementation-record.md` §「验证原始摘要」与 §「Blockers / deferred」（相对固定 SHA 的实施记录内容）。

| 命令 | 记录症状 |
|------|----------|
| `pnpm test` | 全量两次约 **5 分 24 秒 / 5 分 36 秒**「**手动中止**」，**无最终结果**；第二次含 `--exclude m5-concurrency` **仍无结果** |
| `pnpm test:e2e` | 「全量长时间无最终结果已中止」（blocker 未关闭） |
| 沿用记录 | `tests/integration/training/m5-concurrency.test.ts` 曾记 3 项失败，但「全量超时无法给出失败清单」；排除后仍无全量摘要 → **不能**把“无最终结果”归因于该文件已跑完并失败 |

### 当前聚焦 M6 E2E（实施记录已载）

同文件记录（相对本轮 F03/F04 补齐后）：

```text
pnpm exec playwright test tests/e2e/m6-lifecycle-flow.spec.ts --project=desktop-chromium
  → exit 0；11 passed / 0 failed
pnpm exec playwright test tests/e2e/m6-lifecycle-flow.spec.ts --project=mobile-360
  → exit 0；11 passed / 0 failed
```

结论（记录层面）：聚焦 M6 lifecycle 双 project 可完成并给出最终通过摘要；**全量** E2E 仍无最终通过结果。

### 与阻断有关的配置 / 脚本事实（只读复核）

**`package.json`**

- `"test": "vitest run"` → 无过滤、无 suite 墙钟上限。
- `"test:e2e": "tsx scripts/run-e2e.mts"` → 走监督器脚本，不是裸 `playwright test`。

**`vitest.config.ts`**

- `include`: `tests/unit/**/*.test.ts` + `tests/integration/**/*.test.ts`
- `testTimeout` / `hookTimeout`: `30_000`
- 注释写明共享 Postgres + TRUNCATE；配置强制：
  - `fileParallelism: false`
  - `maxWorkers: 1`
  - `pool: "forks"` + `poolOptions.forks.singleFork: true`
- **未配置** `forceExit` / `teardownTimeout` / suite 级总超时。

**只读枚举（本诊断会话执行，未跑测试主体）：**

- `pnpm exec vitest list` → 约 **769** 条用例行；`tests/unit`+`tests/integration` 下 **76** 个 `*.test.ts`。
- 在单 fork 串行下，墙钟与用例规模强相关；约 5.5 分钟手动中止与「中途截断、无最终汇总」一致（见根因判断）。

**`playwright.config.ts`**

- `fullyParallel: false`，`workers: 1`
- 默认 `timeout: 60_000`
- `testIgnore`: `**/m1-evidence-capture.spec.ts`
- `E2E_SUPERVISED=true` 时不启用内置 `webServer`（由 `run-e2e.mts` 启服）

**只读枚举：** `pnpm exec playwright test --list` → **Total: 68 tests in 8 files**（含 `desktop-chromium` 与 `mobile-360`）。

**单测超时抬升（源码）：**

| 文件 | `test.setTimeout` |
|------|-------------------|
| `tests/e2e/m5-training-flow.spec.ts` | `300_000`（describe）；个别 `180_000` |
| `tests/e2e/m6-lifecycle-flow.spec.ts` | `180_000` |
| `tests/e2e/m1-browser-flow.spec.ts` / `m2-…` / `m4-…` / `p3-r06-…` | `180_000` |

**`scripts/run-e2e.mts`**

- `main()`：先 `execSync("pnpm build")`，再 `startServer()` + `startLifecycleWorker()`，`waitForServer`（默认上限 **180_000 ms**），再 `spawn(... playwrightCli, "test")`（**无额外 path/project 过滤 → 全量 68**）。
- **无**整体 suite deadline；中断依赖信号转发 + `finally` 里 `killProcessTree`。
- 清理后断言端口空闲并打印 `Port ${port}: no LISTENING process`。

**历史 archive E2E 日志（只读对照，未改）：** M1 时代 supervised 跑为「Running 10 tests using 1 worker」、约 1.3m 出最终结果。当前 list 为 **68** 条，规模显著大于 archive 成功样例；说明「监督器曾能收敛」与「当前全量墙钟远大于历史 10 测」可并存。

---

## 根因判断

### 已确认机制

**已确认（充分解释“为何没有最终结果”的操作/结构机制）：**

1. **全量 Vitest / 全量 E2E 均被配置为单 worker 串行**，且入口命令覆盖几乎全部用例；实施记录写明全量跑被 **手动中止**，因此进程未走到 runner 最终汇总输出。
2. **排除 `m5-concurrency` 后仍无最终结果**（实施记录）→ “无最终结果”**不是**「全量已跑完且仅剩该文件 3 失败」的形态。
3. **聚焦 M6 E2E 能 exit 0 并打印 11 passed** → Playwright/监督路径在缩小范围内可收敛；全量无结果与「全量范围 × 串行 × 长单测超时」一致，而非「M6 规格本身无法出摘要」。

**尚未确认根因（不能在本次只读下钉死的单一缺陷）：**

- 未能用本轮实测证明：若放任墙钟足够长，全量 Vitest/E2E **是否终会**打印最终汇总；或是否在接近结束时因 open handle / DB 连接导致 **测完不退出**。
- 因此：**“墙钟过短截断”为已确认的直接原因形态；“若永不中止是否仍会永久挂起”仍为未确认。**

### 假设（可能性降序 + 可证伪预测）

| # | 假设 | 可证伪预测 |
|---|------|------------|
| H1 | 全量 Vitest 在单 fork 下需要 **远大于 ~5.5 分钟**；历史中止截断了进行中的 suite | 有界中等切片（unit + `data-lifecycle`）在时限内打出最终汇总；全量若给足够墙钟会持续出现新用例名而非卡死同一行 |
| H2 | 全量 E2E（含 build + 68 串行测，多份 180–300s 上限）墙钟远超操作耐心，中止发生在 Playwright 最终汇总之前 | 非全量过滤跑（例如仅 M6 或排除 M5）在有界时限内出汇总；全量日志在中止前仍有用例在推进 |
| H3 | Vitest 在大量集成测后因未关闭客户端/句柄，在汇总前后挂起退出 | 中等切片结束时进程不退出且无新用例输出 >90s（相对 30s `testTimeout` 异常）；加 `forceExit`/`teardownTimeout` 后同切片可退出 |
| H4 | 全量 E2E 卡在某一非 M6 重用例的等待循环直至单测超时上限 | verbose/list 日志长时间停在同一 test title，最终该条以 timeout fail 出现（若跑到） |
| H5 | 本机 Postgres/资源抖动放大串行耗时 | 同一切片重复两次墙钟差异显著，且无单测卡死信号 |

---

## 唯一最小下一步

**只给一条命令（不建议重跑全量 suite）：**

```bash
pnpm exec vitest run tests/unit tests/integration/data-lifecycle --reporter=verbose
```

| 项 | 规定 |
|----|------|
| 工作目录 | 仓库根（含上述 `vitest.config.ts`） |
| **最大时限** | **8 分钟**墙钟；到点停止进程 |
| **预期成功信号** | 持续出现新的通过/失败行，并以 Vitest **最终汇总**（含 `Test Files` / `Tests`）结束且进程退出 |
| **预期失败/异常信号** | 同一用例名 **>90s** 无进展；或满 8 分钟仍无最终汇总 |
| **停止条件** | ① 打出最终汇总；或 ② 单行无进展 >90s；或 ③ 满 8 分钟 |

**判读（供 Codex，不作 GO/NO-GO）：**

- ① → 支持 H1（历史无最终结果主因是全量串行墙钟/过早中止）；**仍不得**据此宣称全量 `pnpm test` / `pnpm test:e2e` 已通过。
- ②/③ → 转向 H3（退出/挂起），再考虑最小基础设施项（`teardownTimeout` / `forceExit` 或 E2E 监督器整体 deadline）；**本次诊断不实施任何修改**。

**不建议：** 直接重跑全量 `pnpm test` 或全量 `pnpm test:e2e`——当前**没有**诊断证据证明这两条命令可在已知有界时限内收敛。

---

## 不改变的 blocker

以下状态**不因本诊断文件而关闭**（与 `p3-implementation-record.md` Blockers / deferred 一致）：

1. **全量 `pnpm test` 仍未通过**（两次无最终结果 / 未获成功汇总）。
2. **全量 `pnpm test:e2e` 仍未通过**（长时间无最终结果已中止）。
3. **容量档 1,000 / 10,000** 仍为 **deferred**（本机未实测）。
4. **生产上线 blocker（规格冻结）** 仍未关闭：供应商、DPA、数据驻留、生产密钥、真实生产备份/演练、法律期限。
5. 沿用记录中的 `m5-concurrency.test.ts` 3 项失败仍为未在本诊断中重跑确认的候选内容 blocker（与“无最终结果”机制分离）。

---

## 诊断元数据

| 项 | 值 |
|----|-----|
| 诊断方式 | 只读：git 核对、配置/脚本阅读、实施记录、`vitest list` / `playwright test --list`、archive 日志对照 |
| 未执行 | `pnpm test`、`pnpm test:e2e`、全量变体、长驻服务、Worker、浏览器 |
| 本文件路径 | `.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance/research/p3-verification-blocker-diagnosis.md` |
| git | 写完后应仅新增本未跟踪文件；**不暂存、不提交** |
