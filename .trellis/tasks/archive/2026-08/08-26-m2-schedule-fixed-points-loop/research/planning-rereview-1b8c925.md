# M2 规划复审 — `1b8c925`（第四轮缺口）

**范围**：`ee79298...1b8c925` 后 Codex 复审仍为 **NO-GO**；仅审规划文档。

## 结论

**NO-GO（修订后再审）**。`1b8c925` 已恢复 §5.3/5.5/5.6 与 §5.7 表，但文档仍含 **`...` 省略占位**与 **§2/§3/§4/§6 粒度不足**，实现者须回推 schema 与查询语义。

## 必须修订（1b8c925 缺口）

1. **消除 `...` 占位**：`fact_versions` INSERT、`settlements ON CONFLICT`、`POST .../maintain-horizon` 标题、prd skip 路径。
2. **§4.2 schema 自包含**：各表 `idempotency_payload_hash` 列；settlements UNIQUE `(fact_version_id, rule_version_id, settlement_period)` 对齐 data-model。
3. **§2/§3 领域与模块表**：恢复读写边界、架构图、Module 职责（不可单行摘要）。
4. **§6 过期语义**：`effectiveStatus` TypeScript 只读逻辑 + 路径×写库行为表。
5. **§6.1 失败路径**：覆盖 F1–F21 可追溯映射（不可仅 9 行摘要）。
6. **§10 测试策略**：不可仅「见 implement.md」；须列层级与入口。
7. **implement §2/§3**：迁移列要点、seed、GET balance/ledger/current/schedule-items 路由。

## 放行条件

同前轮：仅规划文件；`git diff --check`；回复 Trellis `m2-planning-rereview`。
