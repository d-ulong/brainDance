# M4 归并执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 来源分支：`feat/m4-multi-parent-authorization`
>
> 归并执行基线：`5ee0215e87ce4e634b93d64dbf0f3c7d1a694c1e`（P2 实现）；本指令签署 commit 为唯一归并文档基线。
>
> 结论：**GO；只授权 M4 仅快进归并与推送。**

## 允许动作

1. 在来源分支确认工作区干净、分支历史包含 P2 已签署实现 `5ee0215e87ce4e634b93d64dbf0f3c7d1a694c1e` 与本签署记录；不得新增或修改任何业务/测试/任务文件。
2. 获取 `origin/main` 最新状态；若 `main` 或远端已前进导致不能安全 fast-forward，停止并报告完整 SHA，禁止自行 merge commit、rebase 或变基重写。
3. 仅执行 `git checkout main` 后 `git merge --ff-only feat/m4-multi-parent-authorization`，再 `git push origin main`。
4. 推送后读取并报告本地 `main`、`origin/main`、来源分支的完整 SHA；三者必须指向同一 SHA。若不一致，停止并报告。

## 禁止项

禁止业务修改、测试修改、文档修改、依赖升级、merge commit、rebase、reset、force push、删除任务、创建下一里程碑或部署。

## 回报

必须报告：执行前 `origin/main` 完整 SHA、来源分支完整 SHA、归并命令原始摘要、push 摘要、归并后本地 `main`/`origin/main`/来源分支完整 SHA、工作区状态和 blocker。最后只能写：**“M4 已归并并交 Codex 归档审核（非归档完成）。”**
