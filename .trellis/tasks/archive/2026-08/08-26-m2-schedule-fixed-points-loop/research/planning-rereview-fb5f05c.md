# M2 规划复审 — `fb5f05c`（NO-GO 闭合清单）

**审阅范围**：`fb5f05c`；仅规划文件。

## 结论

**待 Codex 独立复审**。Cursor 已按下列残留 FAIL 修订。

| 轴 | ID | 残留问题 | 修订 | 测试 |
| --- | --- | --- | --- | --- |
| 标准 | C4 | `generateHorizonInline` INSERT 缺 data-model 列；`fact_versions` 缺 `source_kind`/`value` | `design.md` §5.8A 全列 INSERT；`implement.md` §2.0.2；§2.0.7 | `m2-schema-constraints.test.ts` |
| 规格 | C11/F28 | §5.8B 回放路径未显式声明跳过 persist | `design.md` §5.8B 步骤 2/4 加 **不 persistExpiredPastWindow**；§4.2.2 F28 断言 | `maintain-horizon` + `plan-end-date` |

## 闭合证据

### 标准轴 C4

- `schedule_items` INSERT 含 `student_id`, `owner_id`, `slot_key`, `source`, `plan_snapshot`
- `fact_versions` 含 `source_kind='system'`, `value` jsonb
- `point_rule_versions.priority`、`point_ledger_entries.source_id` 列存在（M2 NULL）

### 规格轴 F28

- 步骤 5 **先** `persistExpiredPastWindow`（含 no-op）
- 步骤 2/4 回放：**不** persist / generate / audit / outbox

## 剩余风险

无（规划层已知阻断均已闭合；待 Codex 独立 GO/NO-GO）。
