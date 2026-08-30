# M4 归档推送执行指令

> 已归档任务：`.trellis/tasks/archive/2026-08/08-29-m4-multi-parent-authorization`
>
> 目标分支：`main`
>
> 执行基线：`4cb2525d39ce0034ff98a35d9c229e9a03d69915`

> 结论：**GO；只授权推送 M4 归档与会话记录，并核验远端。**

## 允许动作

1. 确认 `main` 工作区干净，且 HEAD 包含 M4 归档 commit 与会话记录 commit。
2. 仅执行 `git push origin main`。
3. 读取并比较 `main` 与 `origin/main` 的完整 SHA，二者必须相同。

## 禁止项

禁止修改文件、创建分支、merge、rebase、reset、force push、部署或启动 M5。

## 回报

报告：执行前本地/远端完整 SHA、push 原始摘要、执行后本地/远端完整 SHA、工作区状态与 blocker。最后只能写：**“M4 归档已推送并交 Codex 最终核验。”**
