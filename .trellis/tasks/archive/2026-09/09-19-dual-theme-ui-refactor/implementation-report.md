# 双主题 UI 重构 · 集中整改回报



- **整改基线 SHA**：`171aa54a7fd9482fadad42374aa6023c00b17621`

- **整改实现 SHA**：（历史段落，见下方终局收敛）

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



## 命令与退出码（历史）



| 命令 | 退出码 |

|---|---|

| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-check.cjs` | 0 |

| `pnpm typecheck` | 0 |

| `pnpm exec eslint`（变更源文件） | 0 |



## 未执行项（累计）



- `pnpm build`（dev 3002 同目录运行中）

- 全量 E2E、真实 DB 写流程

- 200% 缩放、软键盘专项



---



# 计划生命周期最终收敛（C1–C4）



- **收敛基线 SHA**：`72db812bc10b9ed9bd39e65a2ad516c35a7b59e0`

- **实现 SHA**：`46cb21241fce466bdf8b2b902de8f685f79300c5`（运行证据前执行 `node .trellis/tasks/09-19-dual-theme-ui-refactor/sync-implementation-head-pin.cjs` 生成 `implementation-head.pin`）

- **分支**：`main`



## 冻结状态模型（单一 authority）



| 子状态 | 含义 | 互斥写操作 |

|---|---|---|

| 定义草稿 | `definitionDirty` + 表单领先 `plan.revision` | 与 `bindings` / `refresh-bindings` 互斥 |

| 绑定事实 | `plan.bindings`（服务端对齐后的权威集合） | 只由成功写 + GET 或「重新读取绑定」更新 bindings 字段 |

| 绑定目标 | `selectedStudents`（用户勾选，可领先事实） | 重读前对事实做 delta，重读后合并回目标 |

| 写操作 | `writeOpRef`: `definition` \| `bindings` \| `refresh-bindings` 三选一 | handler 入口 `tryBeginWrite`，UI 与 fieldset 同步反映 busy |

| 历史导航 | dirty 时 merge Next `history.state` 后 push guard；clean 时 `history.back()` 折叠 guard 条目 | 不再使用 `skipPop` / 纯 null 覆盖 Next state |



## C1–C4 断言（浏览器 mock，`implementation-head.pin` === `git rev-parse HEAD`）



| ID | 确定断言 | 脚本 |

|---|---|---|

| C1 | 绑定 POST 延迟 800ms 内标题与定义保存 disabled，`PATCH` 数 0；定义/绑定/重读 `writeOpRef` 互斥 | `state-repair-browser.cjs`、`review-72db812-browser.cjs` |

| C2 | 写成功 + GET 失败后取消 B，重读后 B 仍待移除、保存绑定可见；定义标题草稿不变 | 同上 |

| C3 | clean 保存后一次 Back 到列表；Forward 必须离开列表回到编辑后再测 dirty Back | `state-repair`、`review-f98a45a-browser.cjs` |

| C4 | 实施报告去重；`implementation-head.pin` 与 HEAD 一致；JSON 顶层 `implementationSha` 同 HEAD | 全部浏览器脚本 + 本文件 |



## 命令与退出码（`46cb21241fce466bdf8b2b902de8f685f79300c5`）

| 命令 | 退出码 |
|---|---|
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/sync-implementation-head-pin.cjs` | 0 |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-check.cjs` | 0 |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-final-check.cjs` | 0 |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/state-repair-browser.cjs` | 0 |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-f98a45a-browser.cjs` | 0 |
| `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-72db812-browser.cjs` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm exec eslint`（变更源文件） | 0 |



## 声明



**已交审核**


