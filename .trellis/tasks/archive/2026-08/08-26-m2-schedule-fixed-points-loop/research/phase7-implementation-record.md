# Phase 7 Implementation Record — M2 E2E

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Execution baseline（初交）：`a474e72dc7d36f91d36708f3703435ec7c2482c1`
> Remediation baseline：`7429cbfd398d0487e9942a611889c58c93b94fa4`
> Signed Phase 6 implementation：`352bb0224fdb7f51f798af92dea4ca3d0dfa0789`
> 阶段：Phase 7 E2E remediation round 2
> 状态：已交 Codex 审核（非 GO）

## 1. 实现范围

| 路径/文件 | 用途 |
| --- | --- |
| `tests/e2e/m2-schedule-points-flow.spec.ts` | AC-M2-7 七步链路；P7-R01/R02 断言补强 |
| `tests/e2e/ui-helpers.ts` | 共享 fixture/form/login/logout helper（P7-R04） |
| `tests/e2e/m1-browser-flow.spec.ts` | 复用 shared helper；保留 Phase 6 训练汇总选择器修复 |
| `tests/e2e/m1-evidence-capture.spec.ts` | 复用 shared fixture/login；保留 clearCookies logout |
| `tests/e2e/training-flow.spec.ts` | 复用 `loadE2eFixture`（P7-R05）；保留 API-only login/trial helper |

## 2. 整改对照

| ID | 状态 | 证据 |
| --- | --- | --- |
| P7-R01 家长侧完成/今日任务 | 完成 | 最终 parent plan：`schedule-item-${itemId}` 含「已完成」+ `today-task-status` 含「已完成」 |
| P7-R02 maintain 全程守卫 | 完成 | 点击前 count=0；每次导航/reload/重登后 count 恒为 1；Idempotency-Key 断言保留 |
| P7-R03 diff-check 证据 | 完成 | `phase7-remediation.md` 行尾空格已清除；`git diff --check 0ca5208..HEAD` exit 0 |
| P7-R04 共享 helper | 完成 | `ui-helpers.ts`；M1/M2/evidence/training-flow 复用 |
| P7-R05 training-flow fixture | 完成 | 删除本地 `loadFixture`；仅 `ui-helpers.ts` 持有 fixture 路径 |

## 3. 完成定义对照

| 项 | 状态 | 证据 |
| --- | --- | --- |
| desktop + mobile-360 各完整 1–7 | 完成 | `m2-schedule-points-flow.spec.ts` 单用例 × 2 projects |
| 初次加载/GET 零 maintain-horizon POST | 完成 | 点击前 `assertMaintainHorizonPostCount(..., 0)` |
| 显式点击后恰好 1 次 POST + Idempotency-Key | 完成 | 点击后 count=1 + header 断言 |
| 学生/家长双方完成态与余额 | 完成 | 学生 `item-status`；家长 `schedule-item` + `today-task-status` |
| 刷新/重登余额一致 | 完成 | reload + 重新登录断言 |
| 同键 complete 回放仍 1 ledger | 完成 | API 回放 + ledger 计数不变 |
| mobile-360 无横向滚动（NF-2） | 完成 | plan/schedule 页 `assertNoHorizontalScroll` |
| 后续 GET 无额外 maintain POST | 完成 | 全流程 maintain count 恒为 1 |

## 4. 执行项目与用例

| Project | 用例 | 结果 |
| --- | --- | --- |
| desktop-chromium | `AC-M2-7 full path with maintain-horizon guard and idempotent complete` | pass |
| mobile-360 | 同上 | pass |

## 5. 验证命令

| 命令 | 结果 |
| --- | --- |
| `pnpm test:e2e` | exit 0；12 passed |
| `pnpm test` | exit 0；40 files / 274 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；0 errors；3 个既有 warnings |
| `pnpm format` | exit 0；All matched files use Prettier code style |
| `pnpm build` | exit 0 |
| `git diff --check 0ca5208f9ddb86325005febb63197ac29817b480..HEAD` | exit 0 |
| `git status --short --branch` | `## feat/m2-schedule-fixed-points-loop`（clean） |

## 6. 可复现性说明

- E2E 通过 `scripts/run-e2e.mts` 监督器串行执行；运行前确保端口 3002 空闲。
- 每条 M2 运行前经 API 停用已有 active plan，以相对 balance/ledger 基线断言 +10。
- 家长 plan 页日程项使用 `schedule-item-${itemId}`（无独立 `item-status` testid）；学生 schedule 页使用 `item-status-${itemId}`。

## 7. 未覆盖

- Phase 8 最终验收矩阵与证据包
- 最终 M2 GO
