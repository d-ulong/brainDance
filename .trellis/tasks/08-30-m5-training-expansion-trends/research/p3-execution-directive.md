# M5 P3 学生/家长 UI 与联合验收 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> P2 固定实现 SHA：`a9b32f20fd419ed9e5b6f02d818c5553764bbdb8`
>
> 执行基线：**包含本文件的 Codex 指令提交完整 HEAD SHA，以交接 prompt 为准。**
>
> 阶段：**只授权 P3；不授权归并、推送、部署或 M6。**

## 1. 必读与冻结范围

- `prd.md`：R-M5-06～08、AC-M5-08～10；不得回退 AC-M5-01～07。
- `design.md`：§1、§4～7；`implement.md` 仅 P3 与审核/回滚点。
- `research/p1-signoff.md`、`research/p2-signoff.md`、本文件。
- `CONTEXT.md` 的训练年龄档、有效训练、分段趋势、统一训练输入、弱网边界；`docs/product-scope.md` §4.2 与验收表；`docs/architecture.md` 的 Training 与可访问性约束。
- 现有 reaction UI、API/session/visibility/retry 模式及 `tests/e2e/training-flow.spec.ts`，优先复用既有组件和契约。

## 2. 允许范围与完成定义

1. 学生训练入口仅展示反应力、Stroop、数字广度三项；展示用途、年龄档说明和持续可见的“训练记录，非医学或智力评估”提示。
2. 完成 Stroop v1 与数字广度顺背/倒背交互，使用 P1 固定定义和现有 session/event/submit API，不在客户端计算或信任最终成绩。
3. 三项训练统一支持触控/鼠标与 `Space`/`Enter`，使用原生 button、可见焦点、至少 44px 触控目标；禁止拖拽/音频依赖，颜色不得是唯一信息。
4. 复用 visibility/恢复模式：失焦暂停，累计超过 30 秒或恢复失败为 abandoned；短暂断网的事件/submit 重试保持顺序与幂等，界面明确显示重试/未提交状态，避免重复动作。
5. 学生结果页展示类型化指标、definition version、age band、effective/practice 与个人趋势；家长页按已关联学生展示同一隔离规则下的汇总、详细记录入口及趋势，不提供修改原始成绩的动作。
6. 趋势默认 7d，可切换 30d/all；每个 segment 明示版本、年龄档、分段原因和文字摘要，跨段不连接、不比较；无数据和部分覆盖必须明确呈现。
7. 完成 desktop Chromium 与 360×800 两视口 E2E：三项训练主路径、键盘与点击/触控、焦点、失焦、刷新/重新登录、短暂断网重试、趋势窗口/segment、学生与家长授权/解除关系；断言无横向滚动。
8. 建立 `research/p3-implementation-record.md`，形成 AC-M5-01～10 的可定位验收矩阵，明确每项 Route、错误路径、权限边界、DTO、视口与未验证项。

## 3. 禁止项

- 禁止第四项训练、自适应课程、排行榜/脑年龄、跨学生比较、医学/智力诊断、音频/AI、M6、依赖升级和无关重构。
- 禁止改变 P1/P2 已签署协议、指标、趋势、授权或锁语义来迁就 UI；发现生产级不一致时停止并报告 blocker。
- 禁止新增客户端成绩真相、绕过实时关系授权、把原始答案/完整题目写入日志或错误响应。
- 禁止 merge、rebase、reset、push、deploy；禁止重写任务规格、签署和本指令。

## 4. 完整验证

确认数据库隔离且无其他 runner 后串行执行：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

E2E 必须明确报告 desktop Chromium 与 mobile-360 的用例数、失败截图/trace（如有）和横向滚动断言。P1 已签署 helper 诊断债若在全量测试中出现，须如实单列，不得顺手整改或隐瞒；其他真实失败均为 blocker。

## 5. 提交与固定回报

- 只创建一个聚焦 P3 commit；提交 UI、聚焦测试、E2E 与 `p3-implementation-record.md`，不得混入测试输出。
- 固定回报：

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 SHA>
execution_base: <完整 SHA>
status: M5 P3 已交 Codex 审核（非 GO、非 M5 完成）

resolved:
- R-M5-06 / AC-M5-08: <三项训练、双输入、双视口证据>
- R-M5-07 / AC-M5-09: <失焦、刷新、登录、弱网重试证据>
- R-M5-08: <隐私/错误/非诊断证据>
- AC-M5-10: <完整验收矩阵与质量门>

changed_files:
- <文件>

verification_raw_summary:
- <实际命令>: <原始摘要>

e2e_matrix:
- desktop Chromium: <结果>
- mobile-360: <结果>

blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P3 已交 Codex 审核，未归并、未启动 M6。”**
