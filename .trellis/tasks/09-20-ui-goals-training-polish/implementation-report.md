# Implementation report

> 证据 SHA：提交后由 Codex 填写 `FINAL_SHA` 占位符。

## Final SHA

- **FINAL_SHA**: _(pending commit)_
- 基线：`d5ab29831ba5a1b4c0457fa36a5ac40777754c09`

## 变更摘要

- 迁移 `0045_goal_completed_state`：`completed` 状态、`completed_by/at`、约束与 journal。
- 目标：`completeGoal` 服务、`POST /api/goals/[assignmentId]/complete`、评定仅接受 `completed`、DTO/UI 卡片与操作。
- 训练：脱敏 `trialReview` 投影、`TrainingSessionReview` 共享组件、结果页标题区免责声明。
- 壳层：`PageShell` 上海时钟与真实姓名、返回并入标题区、`headingAside`。
- 计划：编辑表单层级、隐藏计划级开始日期、普通页脚保存区；生成范围校验不再静默钳制。
- 日程/弹窗：桌面隐藏移动日历选择器、主题语义 Modal、日程/目标主题色。

## R01–R07 / AC01–AC10 证据矩阵

| ID | 证据 |
|----|------|
| R01 / AC01 | `page-shell.tsx` + `data-testid="shell-display-name"` / `shell-shanghai-clock`；集成/E2E 见未执行项 |
| R02 / AC02 | `PageShell` 内联 `bd-back-link-inline`；既有 `onBeforeNavigate` 未改 |
| R03 / AC03 | `plan-library-edit-form.tsx`；`plan-library.service.ts` 生成边界错误 |
| R04 / AC05 | `globals.css` 日历/Modal；`schedule-calendar.tsx` 结构保留 |
| R05 / AC06–AC07 | `goal.service.ts` + `goal-complete.test.ts` + `goals-and-manual-penalties.test.ts` |
| R06 / AC08–AC09 | `training-review.ts` + `training-review.test.ts` + 结果页 `headingAside` |
| R07 / AC10 | 计划绑定/生成校验与既有 C1–C4 路径未削弱；聚焦测试通过（见下） |

## 命令与结果

| 命令 | 结果 |
|------|------|
| `DATABASE_URL=…/braindance_test pnpm exec vitest run tests/unit/training/training-review.test.ts tests/integration/goals/goal-complete.test.ts tests/integration/migrations/goal-completed-constraints.test.ts tests/integration/settlement/goals-and-manual-penalties.test.ts tests/integration/goals/goal-horizon-and-gift-redemption.test.ts tests/integration/training/training.test.ts` | **17/17 通过**（journal 修复后） |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过（0 error，既有 warning） |
| `git diff --check` | 通过 |
| `DATABASE_URL=…/braindance_test pnpm exec drizzle-kit migrate` | 0045 已应用 |
| 聚焦 Playwright 360/768/1440 + 糖果/太空截图 | **未执行**（见下） |

## 授权 / 幂等 / 并发 / 迁移断言

- **迁移**：`goal-completed-constraints.test.ts` 遗留 `succeeded` 无 completion 字段合法；半填 completion 对拒绝。
- **完成**：`goal-complete.test.ts` 仅 subject、`goal_commands` 幂等回放、audit/outbox 各一条。
- **评定**：仅 `completed` → `succeeded|failed`；非责任家长 `FORBIDDEN`（既有 + complete 流程）。
- **训练答案**：`training-review.test.ts` 断言响应 JSON 不含原始 payload 字段。

## 截图路径

- 计划：`references/schedule-current.png`（缺陷证据，非目标稿）
- 主题/响应式验收截图：**未捕获**（Playwright 未跑）

## 未执行项

- 聚焦 Playwright（`student-plans-calendar`、`theme-top-tabs`、`training-shell-leave` 等）在 360/768/1440 下的浏览器证据。
- 糖果/太空主题日程日周月、完成弹窗、目标卡片、训练结果截图。
- `pnpm build`（工作区可能存在试点 dev server，按 AGENTS 未执行）。

## 建议合并到 lessons/memo（由 Codex 处理）

- Drizzle 手工 SQL 迁移必须同步 `_journal.json`，否则 isolated DB 不会应用新列。
- 目标评定前必须先 `completeGoal`；集成测试需同步更新流程。
