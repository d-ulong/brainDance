# M3 仅快进归并 Cursor 执行指令

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 授权阶段：M3 归并（仅此阶段）
>
> 目标：将已签署的 `feat/m3-ledger-reliability` 仅快进归并到 `main` 并同步 `origin/main`。

## 固定基线与必读材料

- 执行分支：`feat/m3-ledger-reliability`
- 执行基线：本指令所在的提交（执行前报告 `git rev-parse HEAD` 完整 SHA）。
- 待归并实现 SHA：`909158b79e83616806bae657add37745b85a72e6`；它必须是当前分支历史中的祖先。
- `main` / `origin/main` 预期基线：`d78a0a9c2a16a77e9f1ca94cb9a9c6e7836101a8`。
- 必读：`m3-final-signoff.md` 全文。

## 唯一允许动作

工作区干净、基线均匹配后，按顺序执行：

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 909158b79e83616806bae657add37745b85a72e6 HEAD
git switch main
git merge --ff-only feat/m3-ledger-reliability
git push origin main
git fetch origin main
git rev-parse main
git rev-parse origin/main
git status --short --branch
```

## 禁止项与完成定义

- 禁止任何业务代码、测试、任务规格改动；禁止 merge commit、rebase、reset、force push、删除分支、部署或启动 M4。
- 若工作区不干净、任一基线不符、无法 `--ff-only` 或推送后 SHA 不一致，立即停止，不做替代性操作。
- 完成定义：本地 `main`、`origin/main` 均为同一完整 SHA，且该 SHA 包含 `909158b79e83616806bae657add37745b85a72e6`；工作区干净。

## 固定回报格式

```text
branch: <当前分支>
HEAD: <完整 SHA>
execution_baseline: <完整 SHA>
merged_implementation: 909158b79e83616806bae657add37745b85a72e6
local_main: <完整 SHA>
origin_main: <完整 SHA>
changed_files: none (merge-only)
command_summary: <逐条原始摘要>
blockers: <none 或详情>
status: M3 已归并，等待 Codex 最终归档审核（非自行 GO）
```
