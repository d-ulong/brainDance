# M5-L01 仅快进归并 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 纠偏分支：`fix/m5-lockfile-reconciliation`
>
> 固定纠偏 SHA：`4379bca843c8cf4870768358928885ba92202a5b`
>
> 执行基线：**包含本文件与签署的 Codex 完整提交 SHA，以交接 prompt 为准。**
>
> 阶段：**只授权仅快进归并、推送与 SHA 核对；不授权部署、归档或 M6。**

## 执行

1. 确认当前分支为 `fix/m5-lockfile-reconciliation`，HEAD 等于交接执行基线，工作区干净。
2. 确认本地 `main` 与 `origin/main` 均为 `0d9f240a9991e48cb3da892ed25e56ec3a7ea6d6`；如远端已前进或无法仅快进，立即停止。
3. 切换到 `main`，执行 `git merge --ff-only <执行基线完整SHA>`，然后普通 push `main`。
4. 核对本地 `main`、`origin/main` 与执行基线完整 SHA 完全一致，且工作区干净。

禁止 merge commit、rebase、reset、force-push、部署、归档、创建分支或启动 M6。

## 回报

```text
status: M5-L01 已仅快进归并并推送，等待 Codex 最终归档复验
execution_base: <完整 SHA>
main_before: 0d9f240a9991e48cb3da892ed25e56ec3a7ea6d6
origin_main_before: 0d9f240a9991e48cb3da892ed25e56ec3a7ea6d6
main_after: <完整 SHA>
origin_main_after: <完整 SHA>
merge_mode: ff-only
push: <原始摘要>
worktree: <git status --short --branch 原始摘要>
blockers: <无则写 none>
```

最后一句必须是：**“M5-L01 已仅快进归并并推送，未部署、未启动 M6，等待 Codex 最终归档复验。”**
