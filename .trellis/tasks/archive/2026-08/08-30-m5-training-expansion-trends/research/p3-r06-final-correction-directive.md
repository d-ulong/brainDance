# M5 P3-R06 最终纠偏 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 分支：`feat/m5-training-expansion-trends`
>
> 固定待复验 SHA：`e0f118e28621d9cd9705d5b2b848ee2bcffd19e0`
>
> 验收线审计：P3-R05 已关闭；P3-R06 仍为同一生产级竞态的部分实现。本轮只纠正 P3-R06-C1/C2，不增加需求。
>
> 状态：**NO-GO；禁止归并或启动 M6。**

## P3-R06-C1 — 门禁 ref 未与 visibility 事件同步

- **依据**：上一指令 §3 要求“同步 current-state ref”；R-M5-07、AC-M5-09。
- **现状**：`pausedRef.current = paused` 只在 React render 更新。`visibilitychange` 调用原始 `setPaused(true)` 后、React render 前，pending stimulus append 仍可能看到 `isInteractionAllowed() === true`。页面启用时若已是 `document.hidden`，hook 也没有初始同步。
- **修订**：所有 pause 写入必须先同步更新权威 ref、再更新 React state；blur coordinator 只能调用该同步入口。启用并绑定 session 时立即根据当前 `document.hidden` 做一次幂等同步。`isInteractionAllowed()` 必须在同一事件循环内反映 hidden/terminated/error 的最新禁止状态。
- **验证**：使用真实 hook/component harness 与 deferred append，触发真实 `visibilitychange` 后在 React rerender 前 resolve append，断言 Reaction/Stroop 不开放、Digit Span 不建 timer；再覆盖组件启用时初始 hidden。恢复成功后才允许继续，failure/abandoned 永不开放。

## P3-R06-C2 — Digit Span timer 拒绝推进时丢失剩余时间

- **依据**：上一指令 §3“隐藏时只保存剩余展示时长，不创建/推进 timer”。
- **现状**：timer callback 在检查门禁前把 `displayRemainingRef` 和 `displayStartedAtRef` 清零。若 callback 在 hidden/render-effect 竞态窗口运行，它虽不进入 response，却也无法在恢复后重新调度，训练永久停在 stimulus。
- **修订**：timer callback 只有在最新门禁允许时才清零并进入 response；若禁止，按已展示的可见时长保存非负剩余时间并保持 stimulus，恢复成功后只重建一个 timer。处理零值边界时不得永久卡住或隐藏推进。
- **验证**：用 fake timer 驱动实际 Digit Span 计时控制路径，覆盖 visibility 已 hidden、pause effect 尚未清 timer 时 callback 到期；断言剩余时间未丢、隐藏期间不进入 response、恢复后恰好一次进入 response。

## 范围与质量门

只允许修改上述同步门禁、Digit Span timer 及其真实 hook/component 回归测试，并更新 `p3-implementation-record.md`。不得修改已通过的 P3-R05 coordinator 语义、服务端、schema、P1/P2、E2E 答案 helper、依赖或其他非阻断债务；禁止 merge/rebase/reset/push/deploy。

现有纯 helper tests 可保留，但不能作为 C1/C2 的唯一证据。必须新增能在旧实现上稳定失败的真实生命周期测试。

```bash
pnpm test <P3-R06-C1/C2 真实回归测试文件>
pnpm test tests/unit/training/training-blur-coordinator.test.ts tests/unit/training/training-event-queue.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

只提交一个聚焦 commit。P3-R06 聚焦测试、typecheck、build 和双视口 M5 E2E 必须退出 0；仅已登记的 P1 helper 诊断债可非阻断。

## 回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 SHA>
execution_base: <包含本指令的完整 SHA>
status: M5 P3-R06 最终纠偏已交 Codex 复验（非 GO、未归并）
resolved:
- P3-R06-C1: <同步 ref、初始 hidden、真实 deferred 生命周期测试证据>
- P3-R06-C2: <实际 timer 保留/恢复测试证据>
changed_files:
- <文件>
verification_raw_summary:
- <命令>: <退出码和原始摘要>
e2e_matrix:
- desktop Chromium: <结果>
- mobile-360: <结果>
blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P3-R06 最终纠偏已交 Codex 复验，未归并、未启动 M6。”**
