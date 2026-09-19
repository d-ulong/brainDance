# 双主题 UI 重构 · 实施回报

- **基线 SHA**：`f87d495a2136b0729aebd14f67ed1317e78f6f1b`
- **实现 SHA**：（见本次聚焦提交，提交后填写）
- **分支**：`main`

## 路由 / 入口映射

| 区域 | 路由 | 组件 |
|---|---|---|
| 学生首页 | `/` | `StudentHomeDashboard` |
| 家长首页 | `/` | `ParentHomeDashboard` |
| 计划独立编辑 | `/student/plans/[planId]/edit`、`/parent/plans/[planId]/edit` | `PlanLibraryEditForm` |
| 主题偏好 | `/account`、`/login`（切换） | `ThemeToggle` + `ThemeBootstrapScript` |
| 手机日程列表 | `/student/plans?view=schedule` 等 | `ScheduleCalendar` → `schedule-mobile-day-list` |

## R/AC 证据（摘要）

| ID | 证据 |
|---|---|
| R01/AC01 | `globals.css` space/candy 独立 token；`ThemeBootstrapScript` + `braindance-theme`；截图 `evidence/sample-*-candy-360.png` 与 space 对照 |
| R02/AC02 | `StudentHomeDashboard` + `pickNextScheduleItem`；`data-testid=student-next-task`；Vitest `home-schedule.test.ts` |
| R03/AC03 | `ParentHomeDashboard` 学生概览优先；`top-tabs` 家长训练 Tab；桌面侧栏 CSS `@media (min-width:900px)` |
| R04/AC04 | `schedule-mobile-day-list` 手机默认列表；桌面保留 `bd-calendar-*` 网格 |
| R05/AC05 | 既有计划列表工具栏/卡片样式保留于 `parent/students/plans` 等（本次未改业务） |
| R06/AC06 | 独立编辑页与分组表单；列表「编辑」跳转新路由，保存仍走 `updatePlanLibrary` |
| R07/AC07 | 训练 intro 使用 `bd-training-intro`；刺激区 DOM/逻辑未改 |
| R08/AC08 | 首页/日程加载失败 Alert + 重试；计划编辑离开确认 |
| R09/AC09 | 登录 `bd-login-card` 标题表单同组；触控目标 ≥44px 类保留 |
| R10/AC10 | 未改 API/服务；mock 截图与真实后端分开说明 |

## 命令与退出码

| 命令 | 退出码 | 说明 |
|---|---|---|
| `pnpm typecheck` | 0 | |
| `pnpm exec eslint`（变更文件） | 0 | |
| `DATABASE_URL=.../braindance_test pnpm exec vitest run tests/unit/schedule/home-schedule.test.ts tests/unit/schedule/schedule-calendar.test.ts` | 0 | 6 tests |
| `node docs/ui-audit/2026-09-18/capture.cjs --sample` | 1 | 部分路由截图成功；`reaction-start` / 计划工作台按钮与固定底栏重叠导致 Playwright 点击超时（已加 `padding-bottom`，脚本需滚动或 `--finish` 适配） |

## 截图路径（mock API，非后端业务证明）

- 归档：`.trellis/tasks/09-19-dual-theme-ui-refactor/evidence/`
- 临时源：`%TEMP%/braindance-ui-audit-20260918/`

## 未执行项 / 风险

- 全量 E2E、`pnpm build`（dev 同目录运行中，按 AGENTS 未执行 build）
- 768×1024 专用截图矩阵未全量重跑；1440/360 样本已归档
- 200% 文字缩放、软键盘、真实 DB 写流程未在本轮复验
- 固定底栏与页面底部控件在极短视口仍可能重叠，需 Codex 浏览器复验
- 家长计划编辑页「适用对象」绑定仍在列表页/模态，独立页仅覆盖定义编辑（与既有绑定/generate 事务边界一致）

## 声明

**已交审核**（不得自行 GO）
