# M2 规划复审 — `ee79298`（第三轮缺口）

**范围**：`9c87d40...ee79298` 后 Codex 复审仍为 **NO-GO**；仅审规划文档。

## 结论

**NO-GO（修订后再审）**。`ee79298` 在 prd/implement 主 AC 与 §5.8 等处已闭合首轮阻断 #1–#8 的主体语义，但 **design.md 仍含「同前」占位与缺失段落**，实现者无法仅读当前提交完成设计。

## 必须修订（ee79298 缺口）

1. **design.md §5.3 / §5.5 / §5.6** 使用「（同前…）」占位 — 须恢复停用、inline 结算、启规则的完整步骤与事务边界。
2. **design.md §5.7** 表级幂等仅一行摘要 — 须恢复完整命令×scope 表，并显式标注 schedule_events **跨 actor → 409**。
3. **design.md §5.2 / §5.4 / §5.4b** 步骤粒度不足 — 须含 payload hash、回放跳过、状态竞争与窗口语义。
4. **design.md §4.5** payload hash 规则过简 — 须写清规范化、回放/409 与 actor/scope 关系。
5. **implement.md §3** `src/modules/settlement/ ...` 省略 — 须列出 settlement 模块与 Route 完整路径。
6. **失败路径可追溯** — design 增 §6.1 HTTP 摘要 ↔ 矩阵 F 项映射。

## 放行条件

- 仅修改 M2 任务目录规划文件；不 `task.py start`、不实现分支、无迁移/API/业务代码。
- `git diff --check` 通过；提交后回复 Trellis `m2-planning-rereview` 含 SHA 与逐项位置。
