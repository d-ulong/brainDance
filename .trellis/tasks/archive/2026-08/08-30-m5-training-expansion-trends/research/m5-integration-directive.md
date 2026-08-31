# M5 仅快进归并 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 已签署功能分支：`feat/m5-training-expansion-trends`
>
> 固定签署实现 SHA：`efa4e021dc61776f64173773a279a024324600ec`
>
> 执行基线：**包含本文件与 `p3-signoff.md` 的 Codex 完整提交 SHA，以交接 prompt 为准。**
>
> 阶段：**只授权 M5 仅快进归并、推送与 SHA 核对；不授权部署、M6 或其他实现。**

## 1. 前置核验

1. 当前分支必须为 `feat/m5-training-expansion-trends`，HEAD 必须等于交接 prompt 的完整执行基线，工作区必须干净。
2. `git merge-base main feat/m5-training-expansion-trends` 必须等于当前本地 `main` 完整 SHA，证明可以仅快进。
3. 拉取/推送前记录 `main`、`origin/main`、功能分支完整 SHA；若远端已前进、需要非快进、出现冲突或工作区不干净，立即停止报告，不得自行 rebase、merge commit、reset、force-push 或改写历史。

## 2. 唯一授权动作

1. 切换到本地 `main`。
2. 使用 `git merge --ff-only <执行基线完整SHA>` 归并已签署分支，禁止普通 merge commit。
3. 推送 `main` 到 `origin`，禁止 force push。
4. 核对本地 `main`、`origin/main` 与执行基线三者完整 SHA 完全一致。
5. 确认工作区干净。不得归档任务，不得创建 M6 分支；这些由 Codex 在归并复验后另行决定。

## 3. 完成定义与回报

```text
status: M5 已仅快进归并并推送，等待 Codex 归并复验
execution_base: <包含签署和本指令的完整 SHA>
feature_branch: feat/m5-training-expansion-trends
feature_sha: <完整 SHA>
main_before: <完整 SHA>
origin_main_before: <完整 SHA>
main_after: <完整 SHA>
origin_main_after: <完整 SHA>
merge_mode: ff-only
push: <原始摘要>
worktree: <git status --short --branch 原始摘要>
blockers: <无则写 none>
```

最后一句必须是：**“M5 已仅快进归并并推送，未部署、未启动 M6，等待 Codex 复验。”**
