# Phase 7 Implementation Record — M2 E2E

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Execution baseline：`a474e72dc7d36f91d36708f3703435ec7c2482c1`
> Signed Phase 6 implementation：`352bb0224fdb7f51f798af92dea4ca3d0dfa0789`
> 阶段：Phase 7 E2E
> 状态：已交 Codex 审核（非 GO）

## 1. 实现范围

| 路径/文件 | 用途 |
| --- | --- |
| `tests/e2e/m2-schedule-points-flow.spec.ts` | AC-M2-7 七步链路；desktop-chromium + mobile-360 各 1 用例 |
| `tests/e2e/m1-browser-flow.spec.ts` | 最小选择器修复：Phase 6 家长学生列表改为「训练汇总」链接后，M1 E2E 需按 list item + link 定位（NF-1 回归） |

## 2. 完成定义对照

| 项 | 状态 | 证据 |
| --- | --- | --- |
| desktop + mobile-360 各完整 1–7 | 完成 | `m2-schedule-points-flow.spec.ts` 单用例 × 2 projects |
| 初次加载/GET 零 maintain-horizon POST | 完成 | `maintainPostsDuringLoad.length === 0` 至点击前 |
| 显式点击后恰好 1 次 POST + Idempotency-Key | 完成 | 请求监听器 + header 断言 |
| 学生 pending 完成 → +10 → 双方余额/今日任务 | 完成 | `points-balance`、`today-task-status`、`item-status` |
| 刷新/重登余额一致 | 完成 | reload + 重新登录断言 |
| 同键 complete 回放仍 1 ledger | 完成 | API 回放 `idempotentReplay: true`；ledger 计数不变 |
| mobile-360 无横向滚动（NF-2） | 完成 | `assertNoHorizontalScroll` 于 plan/schedule 页 |
| 不依赖固定实现 ID | 完成 | 动态 `itemId`、相对 balance/ledger 基线 |

## 3. 执行项目与用例

| Project | 用例 | 结果 |
| --- | --- | --- |
| desktop-chromium | `AC-M2-7 full path with maintain-horizon guard and idempotent complete` | pass |
| mobile-360 | 同上 | pass |

## 4. 验证命令

| 命令 | 结果 |
| --- | --- |
| `pnpm test:e2e` | exit 0；12 passed（含 M2 ×2、M1 ×4、training ×2、home ×4） |
| `pnpm test` | exit 0；40 files / 274 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；0 errors；3 个既有 warnings |
| `pnpm format` | exit 0；All matched files use Prettier code style |
| `pnpm build` | exit 0 |
| `git diff --check a474e72..HEAD` | 待提交后复验 |
| worktree | 待提交 |

## 5. 可复现性说明

- E2E 通过 `scripts/run-e2e.mts` 监督器串行执行；`global-setup` 写入 `tests/e2e/.fixture.json`。
- 每条 M2 运行前经 API 停用已有 active plan，以相对 balance/ledger 基线断言 +10，避免跨 project 共享 DB 干扰。
- 若端口 3002 被占用，需先释放再跑 `pnpm test:e2e`；勿与 vitest 并发写同一测试库。

## 6. 未覆盖

- Phase 8 最终验收矩阵与证据包
- 最终 M2 GO
