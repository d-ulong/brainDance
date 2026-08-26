# M2 规划复审 — 最终放行前闭合（S-C4 + C8）

**审阅范围**：`fe5bc1a` 后最终放行复审；仅规划文件。

## 结论

**待 Codex 独立 GO**。Cursor 已闭合下列 FAIL。

| ID | 问题 | 修订 | 测试 |
| --- | --- | --- | --- |
| **S-C4** | data-model 残留漂移：`point_rules.status`；fact/ledger 缺可空列 | `implement.md` §2.0.2–§2.0.4/§2.0.7；`design.md` §4.2/§4.6 | `m2-schema-constraints.test.ts` |
| **C8** | horizonThrough 无单元测试映射；七 Route Idempotency 未在 implement 枚举 | `implement.md` §3.1/§4.1/§4.2.3；`design.md` §7.1/§10 | `horizon-through.test.ts` + F22/F23 |

## 闭合证据

### S-C4

- `point_rules.active` boolean（**非** `status` text）
- `fact_versions`：`confirmed_at`/`confirmed_by`/`supersedes`/`voided_at` NULL
- `point_ledger_entries`：`reverses_entry_id`/`created_by` NULL
- `schedule_items.slot_key='default'` vs occurrence_key 含 `daily:{localTime}` 已文档化

### C8

- `horizonThrough(plan, now)` 唯一实现源 `time-policy/horizon-through.ts`
- §3.1 七类写 Route 表 + F23 测试映射

## 剩余风险

无。
