# Phase 6 Execution Directive — Web UI

## 1. Active task 与固定基线

- Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
- 目标分支：`feat/m2-schedule-fixed-points-loop`
- 已签署 Phase 5 实现基线：`ca2f4bb644755cc0ac07ee34d4517c207076bcff`
- 执行基线：包含本指令与 `phase5-signoff.md` 的 Codex 文档提交；Cursor 开始前必须记录其完整 SHA，且不得切换分支或改写历史。
- 本阶段唯一目标：实现规划已冻结的 Phase 6 Web UI；不编写 Phase 7 E2E。

## 2. 唯一必读文档

Cursor 实现前只按以下权威章节取数，不从聊天推断契约：

1. `design.md` §11（全部三类 Web 行为与 NF-2）；
2. `prd.md`“Web 与 E2E”、AC-M2-F14、Non-Functional 中与 Web/360px 有关的条款；
3. `implement.md` §1 Phase 6；
4. `research/phase5-signoff.md`（确认上游 Route/API 已签署）。

## 3. 允许修改范围

- `src/app/parent/students/[studentId]/plan/`：家长计划 CRUD、启用固定积分规则、查看日程/积分，以及显式“补齐日程”按钮；
- `src/app/student/schedule/`：学生日程列表与完成按钮；
- 现有首页/共享 shell/积分卡片中，为双方展示余额与今日任务所必需的最小修改；
- `src/lib/client/` 或邻近 UI 层中，为调用已签署 Phase 5 API 所必需的最小类型/API helper；优先复用现有实现；
- 与本阶段 UI 行为直接对应的聚焦组件测试（若仓库现有测试设施适用）；
- 本任务目录中的 Phase 6 实施记录/验证矩阵，仅记录真实完成情况。

页面必须复用 Phase 5 Route，不复制 Schedule/Settlement 领域规则。所有写操作生成并传递 `Idempotency-Key`；“补齐日程”只能由用户点击触发，页面 mount、render、GET、refresh 均不得自动 POST。

## 4. 明确禁止

- 不修改 Phase 1–5 已签署的迁移、领域服务、Route 契约或业务语义；若现有 API 无法满足 UI，停止并回报 blocker；
- 不实现 Phase 7 `tests/e2e/m2-schedule-points-flow.spec.ts`，不修改 E2E runner/bootstrap；
- 不实现 skip UI；不增加多家长 UI、人工事实、兑换、手动奖励或其他 M2 Out of Scope；
- 不新增第三方依赖，不做无关重构、清理或全库格式化；
- 不执行部署、合并、rebase 或 force-push；不自行宣布 Phase 6 GO 或进入 Phase 7。

## 5. 完成定义

- `/parent/students/[studentId]/plan` 支持计划 CRUD、启规则、查看日程/积分；显式按钮点击调用 maintain-horizon，且不存在 mount/useEffect 自动 POST；
- `/student/schedule` 展示日程并可完成 pending 项；完成后可看到更新后的余额/今日任务状态；
- 首页或共享积分卡片为家长与学生展示余额和今日任务，且不产生隐式写入；
- 360×800 下上述页面无横向滚动，关键操作可达；desktop 行为正常；
- 写请求携带稳定生成的 `Idempotency-Key`，错误与加载状态可理解且不重复提交；
- 修改聚焦，质量门通过，实施记录与真实文件/验证一致；
- Cursor 创建一个聚焦 Git commit。

## 6. 必须运行的验证命令

按顺序运行并保留原始摘要：

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <执行基线完整SHA>..HEAD
git status --short --branch
```

另须手动验证 desktop 与 360×800：家长页、学生页、余额/今日任务卡片，以及“初次加载不发生 maintain-horizon POST；仅点击按钮发生一次 POST”。记录所用页面、视口、操作和结果。Phase 7 E2E 本轮不得编写或宣称通过。

## 7. Cursor 固定回报格式

完成后提交，并严格按以下格式回报：

```text
SHA: <完整 40 位提交 SHA>
Execution baseline: <本指令所在完整 SHA>
Changed files:
- <path>: <用途>
Commands and raw results:
- <command>: <exit code + 原始测试/检查摘要>
Manual verification:
- <viewport + 页面 + 操作 + 结果>
Unresolved blockers:
- none | <blocker>
```

Cursor 只声明“Phase 6 实现已交 Codex 审核”，不得自行声明 GO、签署、归并或进入 Phase 7。
