# M2 规划复审 — `3e6df81`（标准轴 + 规格轴）

**审阅范围**：`82cdf27...3e6df81`；仅规划文件。

## 结论

**NO-GO**。须关闭下列 4 项 FAIL 后复审。

## 标准轴

| ID | 结果 | 位置 | 必须修订 | 验证 |
| --- | --- | --- | --- | --- |
| C4 | FAIL | `implement.md` §2 | §2.0 缺 `plan_type`/`start_date` 等列；settlements/ledger/projection/horizon_maintains 粒度不足；无 design §4.2 交叉表 | implement §2.0.6 ↔ design §4.2 逐行 PASS |
| C6 | FAIL | `design.md` §5.1/§5.2/§5.8B | PATCH 须 UPDATE `plans.end_date`；`cancelPendingAfterEndDate` 须命名；maintain no-op 时 **不得** 发 `schedule.horizon_maintained` outbox；`from > through` 边界 | plan-end-date.test.ts（F22） |

## 规格轴

| ID | 结果 | 位置 | 必须修订 | 验证 |
| --- | --- | --- | --- | --- |
| C11 | FAIL | `planning-signoff-checklist.md` C7/C8；`design.md` §8 | checklist C7 仍写 ledger 全局 UNIQUE；`horizonThrough`/`add-family-days.ts` 未列入 implement §3 | checklist C11 PASS；implement §3 含 horizon-through.ts |
| C12 | FAIL | `design.md` §5.5；checklist | balance UPSERT 须写清 `EXCLUDED.amount`；冲突回放禁止累加；与 implement §2.0.4 一致 | settlement-ledger.test.ts（F25） |

## 禁止事项

同 `planning-rereview-7804743.md`。
