# Phase 8 Final Verification Package — M2

> **Status:** submitted for Codex final review（非最终 GO）
> **Active task:** `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> **Target branch:** `feat/m2-schedule-fixed-points-loop`
> **Execution baseline:** `184d82964281d50e2cab1faaac053b9612cecf6c`
> **Phase 8 remediation baseline:** `05f2a22ab41c9928665649d3b5ef1253a155ea7d`
> **Signed product implementation SHA:** `9422c5fb6daf604ffeb6e7c527600f9d7562b391`（Phase 7；Phase 8 无业务/测试变更）
> **Evidence run date:** 2026-08-28
> **Evidence author:** Cursor Phase 8 execution

## 1. Purpose and boundary

本包在固定基线 `184d829` 上，对 M2 全量验收矩阵（AC-M2-1–8、F1–F28、NF-1–8）进行证据对账与独立串行复验。不包含归档、合并、部署或最终 GO 声明。

| 边界 | 说明 |
| --- | --- |
| 已覆盖 | 矩阵全 ID 的可定位测试/命令证据；Phase 1–7 签署 SHA 链；2026-08-28 独立质量门串行复跑 |
| 未覆盖 | 生产部署、任务归档、最终 M2 GO、交互式浏览器人工抽检（Phase 6 遗留项已由 Phase 7 E2E 替代） |
| 禁止项遵守 | 未修改应用代码、测试、迁移、配置或历史 phase signoff/remediation 记录 |

## 2. Signed implementation SHA chain

| Phase | 范围 | 签署/实现 SHA | 证据来源 |
| --- | --- | --- | --- |
| 1 | 迁移 0008–0013、schema、seed、约束测试 | `fe7c54ffdaf5acacd42854960f6cfcceb1978864` | `research/phase1-consolidated-remediation.md` §10 |
| 2 | time-policy 扩展 | `f82bd34d857df776b3dfad7d317ca25918009ad3` | `research/phase2-remediation.md` §4 |
| 3 | Schedule 领域（CRUD、horizon、complete/skip） | `9916c7d93a241986d56f9791ee5dd432f59fb910` | `research/phase3-signoff.md` |
| 4 | Settlement + Ledger | `ee54e601f39d2da9200028bfb885ca367fd4f9a2` | `research/phase4-signoff.md` |
| 5 | Route Handlers + API 测试 | `ca2f4bb644755cc0ac07ee34d4517c207076bcff` | `research/phase5-signoff.md` |
| 6 | Web UI（计划/日程/积分页） | `352bb0224fdb7f51f798af92dea4ca3d0dfa0789` | `research/phase6-signoff.md` |
| 7 | desktop + mobile-360 E2E | `9422c5fb6daf604ffeb6e7c527600f9d7562b391` | `research/phase7-signoff.md` |
| 8 | 最终验证矩阵与证据包（仅文档） | 本提交 SHA | 本文档 + `research/m2-verification-matrix.md` |

## 3. Environment assumptions

| 项 | 值 |
| --- | --- |
| OS | Windows 10（win32 10.0.22631） |
| Node / pnpm | 项目 lockfile 锁定版本；`pnpm test:e2e` 经 `scripts/run-e2e.mts` |
| 数据库 | `DATABASE_URL` 指向本地 PostgreSQL；集成/E2E 前 `migrateTestDb` |
| E2E 端口 | **3002**（`run-e2e.mts` 监督器）；复验前端口无 LISTENING 进程 |
| 并发策略 | 全部命令**串行**执行；未出现需隔离复跑的共享库失败 |
| 跳过的测试 | `SKIP_DB_TESTS=true` 时 DB 集成/E2E 跳过（本轮未设置） |

## 4. Independent quality gate rerun（2026-08-28）

| 命令 | Exit | 原始摘要 |
| --- | --- | --- |
| `pnpm test:e2e` | 0 | 12 passed（desktop-chromium ×6 + mobile-360 ×6）；含 build；port 3002 clean after exit |
| `pnpm test` | 0 | Test Files 40 passed (40)；Tests 276 passed (276)；Duration ~246s |
| `pnpm typecheck` | 0 | `tsc --noEmit` 无报错 |
| `pnpm lint` | 0 | 0 errors；3 warnings（`playwright.config.ts` `_nodeEnv`；`scripts/run-e2e.mts` `logPortStatus`/`_nodeEnv` — 与 Phase 7 签署一致） |
| `pnpm format` | 0 | All matched files use Prettier code style!（check only，无变更） |
| `pnpm build` | 0 | Next.js 15.5.23 production build completed；27 static + dynamic routes |
| `git diff --check`（remediation 提交前工作区） | 0 | 无 trailing whitespace/conflict marker |
| `git diff --check 184d82964281d50e2cab1faaac053b9612cecf6c..HEAD` | 0 | **初包误报**：提交前 HEAD 仍等于 `184d829`，该命令实际检查空 committed diff，不能证明 Phase 8 文档变更。Codex 在固定 SHA `60a094d5e3b3c2ae13ae76278415aefce59221a3` 独立复跑 exit 0（非 Cursor 证据）。Remediation 提交后复跑本命令覆盖 Phase 8 + remediation 全部 committed diff。 |
| `git status --short --branch` | — | remediation 提交前仅授权文件变更 |

### E2E 用例明细（12/12）

| # | Project | Spec | 覆盖 ID |
| --- | --- | --- | --- |
| 1–2 | desktop-chromium | `home.spec.ts` | NF-1（M1 回归） |
| 3–4 | desktop-chromium | `m1-browser-flow.spec.ts` | NF-1、NF-2 |
| 5 | desktop-chromium | `m2-schedule-points-flow.spec.ts` | AC-M2-7、NF-2、NF-7 |
| 6 | desktop-chromium | `training-flow.spec.ts` | NF-1 |
| 7–8 | mobile-360 | `home.spec.ts` | NF-1 |
| 9–10 | mobile-360 | `m1-browser-flow.spec.ts` | NF-1、NF-2 |
| 11 | mobile-360 | `m2-schedule-points-flow.spec.ts` | AC-M2-7、NF-2、NF-7 |
| 12 | mobile-360 | `training-flow.spec.ts` | NF-1 |

## 5. Requirement family evidence map

完整逐 ID 状态见 `research/m2-verification-matrix.md` §8–§11。下表按家族汇总可定位证据与证据类型。

| 家族 | 数量 | 主要证据文件 | 证据类型 |
| --- | --- | --- | --- |
| AC-M2-1–8 | 8 | `formal-plan.test.ts`、`maintain-horizon.test.ts`、`schedule-generation.test.ts`、`schedule-complete.test.ts`、`settlement-ledger.test.ts`、`schedule-outbox.test.ts`、`m2-schedule-points-flow.spec.ts` | 独立复跑 + Phase 3–7 继承 |
| F1–F28 including F9b | 29 | `schedule-auth.test.ts`、`formal-plan.test.ts`、`schedule-complete.test.ts`、`schedule-skip.test.ts`、`settlement-ledger.test.ts`、`command-idempotency.test.ts`、`maintain-horizon.test.ts`、`plan-end-date.test.ts`、`schedule-query.test.ts`、`write-route-idempotency-header.test.ts`、`schedule-terminal-concurrency.test.ts`、`persist-expired.test.ts`、`m2-schema-constraints.test.ts` | 独立复跑 + Phase 3–5 继承 |
| NF-1–NF-8 | 8 | 全量 `pnpm test` + `pnpm test:e2e`；`tests/unit/time-policy/*`；`src/db/migrations/0008–0013`；`git diff --check` | 独立复跑 |

### 5.1 M1 回归（NF-1）明细

| 类别 | 基线（M1 签署） | 当前（Phase 8 复跑） | 证据 |
| --- | --- | --- | --- |
| Vitest M1 域 | 53 tests / 12 files | 含于 276 tests / 40 files 全绿 | `tests/integration/identity/`、`family-access/`、`training/`、`outbox/`、`audit/`；`tests/unit/training/` |
| E2E M1 | 10/10 | 10/10（12 总量减 M2 2 项） | `home.spec.ts` ×4（2 tests ×2 projects）、`m1-browser-flow.spec.ts` ×4（2 tests ×2 projects）、`training-flow.spec.ts` ×2（1 test ×2 projects） |

## 6. Inherited vs independently rerun

| 证据 | 类型 | 说明 |
| --- | --- | --- |
| Phase 1–6 领域/Route 单元断言 | 继承 + 全量 `pnpm test` 复跑 | 276/276 通过，覆盖全部集成/单元文件 |
| Phase 7 E2E desktop/mobile-360 | 继承 + `pnpm test:e2e` 复跑 | 12/12 通过 |
| Phase 8 质量门 | 独立 | 本节 §4 表格 |
| Phase 6 人工浏览器抽检 | 被 Phase 7 E2E 替代 | Phase 6 signoff §3 未独立重复 |

## 7. Unverified boundaries

| ID / 边界 | 状态 |
| --- | --- |
| 无 | 矩阵 AC-M2-1–8、F1–F28 including F9b（29 行）、NF-1–8 均有可定位证据；质量门全通过 |

## 8. Known risks（非 Phase 8 blocker）

见 `research/m2-known-risks.md`：Outbox Worker 未实现、生产 TOTP 延期等均在 M2 Out of Scope 内，不阻断本包提交。

## 9. Submission statement

Phase 8 最终验证矩阵与证据包已完成，**submitted for Codex final review**。未声明最终 GO、未归档任务、未合并分支、未部署。
