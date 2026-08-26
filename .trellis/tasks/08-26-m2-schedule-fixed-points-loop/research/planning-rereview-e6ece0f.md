# M2 规划复审 — `e6ece0f`（第五轮缺口）

**范围**：`1b8c925...e6ece0f` 后 Codex 复审仍为 **NO-GO**；仅审规划文档。

## 结论

**NO-GO（修订后再审）**。`e6ece0f` 已补全 §2–§6 主体，但缺少实现必需的**冻结规格**：occurrence_key、状态机、persistExpired 语义、outbox dedupe、非 pending 回放、settlement_period 与 ledger UNIQUE。

## 必须修订（e6ece0f 缺口）

1. **§4.6 occurrence_key** — 冻结格式与 `ON CONFLICT DO NOTHING`。
2. **§4.7 状态机** — pending 迁移与终态 409/回放规则。
3. **§4.8 persistExpiredPastWindow** — 必须用 `isPastCompletionWindow`（非 `family_date < today` 简化）。
4. **§4.9 outbox/audit** — 全事件表 + dedupe_key（AC-M2-8 / F21）。
5. **§5.4/5.4b** — 非 pending 时同键回放 vs 异键 409；complete 发 `points.settled`。
6. **§5.5** — `settlement_period = family_date`；ledger `ON CONFLICT (idempotency_key)`。
7. **§5.8A** — `generateHorizonInline` 算法伪代码。
8. **§6.1** — 补 F2/F4/F8/F19/F21；**§10** — 内联 AC/F→测试映射。
9. **prd** — 去除「见 design §x」；AC-M2-8 含 dedupe 示例。

## 放行条件

同前轮；回复 Trellis `m2-planning-rereview` 含 SHA 与逐项位置。
