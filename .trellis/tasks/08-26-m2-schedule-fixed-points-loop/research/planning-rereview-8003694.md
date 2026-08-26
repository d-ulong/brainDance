# M2 规划复审 — `8003694`（NO-GO 闭合清单）

**审阅范围**：`8003694`；仅规划文件。

## 结论

**待 Codex 独立复审**。Cursor 已按下列 FAIL 项修订。

| 轴 | ID | 问题 | 修订 | 测试 |
| --- | --- | --- | --- | --- |
| 标准 | C4 | 迁移模型漂移：`version_number`/`event_type`/`plan_type` 等与 `docs/data-model.md` 不一致 | `implement.md` §2.0 全表 DDL 同步；新增 §2.0.7 对齐表；`design.md` §4.2/§4.3/§5.4–5.5 | `m2-schema-constraints.test.ts` |
| 规格 | C11 | maintain no-op 未 persist expired | `design.md` §5.8B 步骤 5 统一 `persistExpiredPastWindow`（含 no-op）；回放路径跳过；新增 F28 | `plan-end-date.test.ts`；`maintain-horizon.test.ts` |

## 闭合证据

### 标准轴 C4 — data-model 对齐

- `plan_versions.version`（非 `version_number`）
- `schedule_events.from_status` / `to_status`（非 `event_type`）
- `schedule_items` 补 `owner_id`, `slot_key`, `source`, `plan_snapshot`
- `plans` 补 `goal_id`, `source_plan_id`, `current_version_id`
- `point_balance_projection.last_ledger_entry_id`
- 权威对照：`implement.md` §2.0.7

### 规格轴 C11 — maintain no-op persist

- §5.8B 步骤 2/4 回放 → **不** generate / audit / outbox / persist
- 步骤 4 RETURNING 成功者 → 步骤 5 **先** `persistExpiredPastWindow`（含 `items_created=0`）
- `prd.md` AC-M2-F28；矩阵 F28

## 剩余风险

无（规划层已知阻断均已闭合；待 Codex 独立 GO/NO-GO）。

## 禁止事项

同前轮；未 `task.py start`；无业务代码/迁移/API。
