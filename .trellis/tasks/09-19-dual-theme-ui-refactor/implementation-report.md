# 双主题 UI 重构 · 集中整改回报

- **整改基线 SHA**：`171aa54a7fd9482fadad42374aa6023c00b17621`
- **整改实现 SHA**：（见本次聚焦提交 `git rev-parse HEAD`）
- **分支**：`main`

## B01–B08 对照

| ID | 处理 | 证据 |
|---|---|---|
| B01 | `src/lib/plans/plan-draft-serialization.ts` 完整保留 key/时限/时长/积分；`review-check.cjs` 退出 0；`tests/unit/plans/plan-draft-serialization.test.ts` | 命令见下 |
| B02 | 手机底栏 `top: auto` + 移除 767 冲突 `top:0`；家长侧栏仅 `bd-app-parent` | `evidence-remediation/remediation-student-home-360.png`（mock） |
| B03 | `PlanLibraryEditForm` `onDirtyChange` + `useUnsavedChangesGuard`（beforeunload） | 编辑页 `student/parent/plans/[id]/edit` |
| B04 | `page-shell` 头像 Link 接入 `navigate`/`onBeforeNavigate` | `tests/e2e/training-shell-leave.spec.ts`（新增，见未执行项） |
| B05 | 学生首页分区 fetch；失败显示「—」/分区 Alert，保留成功数据 + stale 提示 | `data-testid=home-schedule-error` / `home-points-error` |
| B06 | 手机周/月选日网格 + 选中日后列表；桌面日视图 `bd-calendar-day-scroll` 初始定位相关小时 | `remediation-student-calendar-week-360.png` 等 |
| B07 | 主题插画、学生桌面无侧栏、家长学生管理/计划筛选/编辑页对象分组/训练专注壳/Modal 焦点与空错状态 | 代码 + `evidence-remediation/*` |
| B08 | 新目录 `evidence-remediation/`，每张 PNG 附带 JSON（sha256/路由/角色/视口/主题/mock） | 不复用 2026-09-18 哈希 |

## AC01–AC10 摘要

| AC | 整改后证据 |
|---|---|
| AC01 | `HomeTaskIllustration` + space/candy SVG 切换；`globals.css` token |
| AC02 | 任务优先首页未改 DTO 语义；mock 截图 `remediation-student-home-360.png` |
| AC03 | `workspace="parent"` 侧栏；`StudentManagementTabs` 新样式；`remediation-parent-students-360.png` |
| AC04 | 手机日/周/月 + 桌面滚动定位 |
| AC05 | 计划列表搜索首屏 +「更多筛选」折叠；筛选无结果 vs 无计划分态 |
| AC06 | 独立编辑：星期选择器、积分/时限、适用对象（家长）、脏数据保护 |
| AC07 | 训练进行态 `hideTabs`/`hideHeading` + `bd-training-active-shell` + 结束训练 |
| AC08 | 分区错误/空态；Modal 焦点 trap + Escape；家长首页就地重试 |
| AC09 | 触控与主题继承延续；登录/账号未回退 |
| AC10 | 无 API/schema 变更；保存仍 `updatePlanLibrary` |

## 命令与退出码

| 命令 | 退出码 |
|---|---|
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-check.cjs` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm exec eslint`（变更源文件） | 0 |
| `DATABASE_URL=postgresql://…/braindance_test pnpm exec vitest run tests/unit/plans/plan-draft-serialization.test.ts tests/unit/schedule/home-schedule.test.ts` | 0（5 tests） |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/capture-remediation.cjs` | 0（21 张 mock 截图） |

## 截图（mock API）

- 目录：`.trellis/tasks/09-19-dual-theme-ui-refactor/evidence-remediation/`
- 每张 `*.json` 含 `sha256`、`route`、`role`、`viewport`、`theme`、`dataSource: playwright-mock`
- 含：`remediation-student-plan-edit-360`、`remediation-student-reaction-active-360`、`remediation-parent-plan-edit-360`

## 未执行项

- `pnpm build`（dev 3002 同目录运行中）
- 全量 E2E / `training-shell-leave.spec.ts`：global-setup 需隔离 `DATABASE_URL`，未在 dev 试点库上跑
- 200% 缩放、软键盘、真实 DB 写流程
- 390×844 专用视口（已覆盖 360×800 / 768×1024 / 1440×1000）

## 声明

**已交最终复验**（不得自行 GO）
