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

---

# 终局 NO-GO 后集中修复（F01–F06）

- **修复基线 SHA**：`ff1fff84d10084c60c8181229a6e7ec28382015f`
- **修复实现 SHA**：`36d23392ee4a720861bd2a442cd48291b3824454`

| ID | 实现要点 |
|---|---|
| F01 | 家长编辑页定义保存与绑定分离；成功后刷新 `revision`；绑定顺序执行、部分失败可重试；加载请求可取消 |
| F02 | Modal 焦点仅在挂载时初始化；`onClose` 用 ref；顶层 modal 栈 + capture 阶段 Escape |
| F03 | `appendPlanDraftEntry` / `nextPlanEntryKey` 保证唯一 key |
| F04 | 每周仅以 `weeklyWeekdays` 序列化；空选择表单校验拦截 |
| F05 | `useUnsavedChangesGuard` 增加 `popstate` + 单次 history guard |
| F06 | 定稿 SVG 插画；手机端 `.bd-task-art` 可见；家长/学生 `/plans/new` 独立页 |

| 命令 | 退出码 |
|---|---|
| `node …/review-check.cjs` | 0 |
| `node …/review-final-check.cjs` | 0（使用 `appendPlanDraftEntry` 模拟添加） |
| `pnpm typecheck` | 0 |
| `DATABASE_URL=…/braindance_test pnpm exec vitest run tests/unit/plans/plan-draft-serialization.test.ts tests/unit/ui/modal-layer.test.ts` | 0（5 tests） |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/capture-remediation.cjs`（实现 SHA 后） | 0（21 张 mock） |
| 增量 `%TEMP%\\bd-evidence-e01f3bc\\final-*-plan-new-360.*` | 0（2 张 mock，含 implementationSha） |

## 未执行项（本轮）

- 浏览器实机：连续 IME 输入、后退/前进全矩阵、200% 缩放、软键盘
- 全量 E2E、`pnpm build`（若 dev 同目录运行）
- 真实 DB 写流程绑定失败重试

**已交审核**

---

# 编辑状态生命周期集中修复（R01–R05）

- **修复基线 SHA**：`7a0a12bb5db5fcaca5d38516a1ee0f395abbb686`
- **实现 SHA**：与本次聚焦提交 `git rev-parse HEAD` 一致
- **分支**：`main`

## 状态表（冻结）

| 阶段 | dirty | 表单基准（plan.id/revision） | 写 API | 离开/启用 |
|---|---|---|---|---|
| 新建草稿 | true | `__create__` / 0 | 无 | 守卫 + 确认 |
| 首次保存后 | false | 服务端 id/revision | POST 一次 | 可启用（仅已保存定义） |
| 已保存再编辑 | true | 同一 id，旧 revision | — | 守卫 |
| 再次保存 | false | 同一 id，新 revision | PATCH | 可启用 |
| 保存进行中 | — | 快照 | POST/PATCH 飞行中 | 字段锁定（fieldset disabled） |
| 有未保存定义 | true | 草稿领先 revision | 禁止启用 | 提示先保存 |
| 绑定目标 | bindingDirty 独立于 definitionDirty | plan.bindings 为事实 | activate/remove 分步 | 失败保留 selectedStudents |

## R01–R05 证据

| ID | 实现要点 | 浏览器/mock 证据 |
|---|---|---|
| R01 | 学生 `/plans/new` 首次 POST、后续 PATCH 同一 `savedPlan`；启用前检查 `dirty` | `state-repair-browser.cjs`：posts=1、patches≥1、同 id；有草稿时停留 new 且无 activate 写 |
| R02 | 共享表单 `fieldset disabled={saving}`；保存锁；不再在页面层强行 `setDirty(false)` | 保存中 `locked=true`；保存后再改取消 `confirms=1` 留页 |
| R03 | 守卫 dirty 时 push、clean 时 `suppressPop`+back 回收；`activeRef` 防竞态 | 两轮保存后 `final≤initial+1`；自列表进编辑后 back 确认到列表 |
| R04 | 部分绑定失败不覆盖 `selectedStudents`；全成功才 refresh 对齐 | B 失败仍勾选；重试仅第 2 次 bind B，`aCalls=0` |
| R05 | 学生编辑页 `onValidationError` | 空星期无写、错误弹窗；选周五后 `weekdays=[5]` |

## 命令与退出码

| 命令 | 退出码 |
|---|---|
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-check.cjs` | 0 |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-final-check.cjs` | 0 |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/state-repair-browser.cjs` | 0（Chrome 无头，全 API mock） |
| `pnpm exec eslint`（变更源文件） | 0 |
| `pnpm typecheck` | 0 |

## 未执行项

- Modal 连续输入 / 叠加 Escape 栈专项浏览器用例（F02 既有单测未在本轮重跑）
- 绑定成功后 refresh 失败分态的独立浏览器场景（R04 代码路径已实现，本轮 mock 仅覆盖部分失败重试）
- `pnpm build`、全量 E2E、真实 DB

## 声明

**已交审核**
