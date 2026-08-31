# M6 P1 实施记录（集中整改 R01–R06）

## 整改映射

| 阻断项 | 整改要点 | 主要文件 | 测试证据 |
|--------|---------|---------|---------|
| P1-F01 | catalog create/update 权威写入 + audit/outbox 同事务；update 补 outbox | `catalog.service.ts` | `P1-F01: rolls back catalog create when audit append fails`; `P1-F01: rolls back catalog update when outbox append fails` |
| P1-F02 | 兑换关系结束处置迁入 Redemption 模块；Family Access 只调用 seam | `relationship-end.service.ts`, `deactivate-creator-configs.service.ts` | `deactivates creator catalog and cancels pending on relationship end`; `AC-M6-01: ending one parent relationship preserves other parent catalog access`; `AC-M6-01: ending one student relationship preserves other student catalog` |
| P1-F03 | 服务端按角色强制学生只读 active；家长可读 inactive 历史 | `catalog.service.ts`, `redemption-catalog/route.ts` | `P1-F03: student cannot read inactive catalog even with activeOnly=false query` |
| P1-F04 | update/reject 幂等重放比较 payloadHash；冲突不泄露旧 payload | `catalog.service.ts`, `redemption.service.ts` | `P1-F04: catalog update replays same payload and conflicts on different payload`; `P1-F04: reject replays same payload and conflicts on different reason` |
| P1-F05 | 批准锁序固定为 redemption → student/balance → monthly rows | `approve-lock-order.ts`, `redemption.service.ts` | `concurrent approve yields one terminal state and one deduction`（monthlyLimit=1）；`concurrent approve and reject yields one terminal state`；`AC-M6-02: concurrent approve and cancel yields one terminal state` |
| P1-F06 | 补全验收矩阵 | 测试文件 | 见下表 |

## 验收矩阵（测试名称 → 要求）

| 测试名称 | 覆盖要求 |
|---------|---------|
| `AC-M6-01: Asia/Shanghai requestMonth boundary at month rollover` | 月末/月初 requestMonth 边界 |
| `enforces monthly limit` / `AC-M6-01: concurrent create at monthly limit allows only one new request` | 月限次唯一结果 |
| `concurrent approve yields one terminal state and one deduction` | 批准×批准（含 monthlyLimit=1） |
| `concurrent approve and reject yields one terminal state` | 批准×拒绝 |
| `AC-M6-02: concurrent approve and cancel yields one terminal state` | 批准×撤销 |
| `AC-M6-01: ending one parent relationship preserves other parent catalog access` | 双 parent 结束一个关系 |
| `AC-M6-01: ending one student relationship preserves other student catalog` | 双 student 结束一个关系 |
| `P1-F03: student cannot read inactive catalog even with activeOnly=false query` | 学生 inactive 过滤 |
| `route matrix: creating parent can create and update own catalog` | catalog create/update 创建家长 |
| `route matrix: other valid parent cannot update creator catalog` | 其他有效家长 |
| `ended parent cannot approve redemption` | 解除家长 |
| `returns 403 when parent accesses another student catalog write` / `route matrix: cross-student redemption write returns forbidden` | 跨学生 |
| `requires Idempotency-Key on write routes` | 缺 header |
| `route matrix: student create/cancel and parent reject with validation errors` | 非法 DTO / unknown ID |
| `route matrix: parent cannot cancel student redemption; student cannot approve` | 角色矩阵 |
| `P1-F01: rolls back catalog create when audit append fails` | 原子回滚（audit） |
| `P1-F01: rolls back catalog update when outbox append fails` | 原子回滚（outbox） |
| `P1-F04: catalog update replays same payload and conflicts on different payload` | update payload 冲突 |
| `P1-F04: reject replays same payload and conflicts on different reason` | reject payload 冲突 |

## 事务、模块边界与锁序

- catalog create/update：`db.transaction` 内完成事实写入、audit、outbox；update dedupe key 为 `redemption_catalog.updated:{idempotencyKey}`，payload 不含正文。
- 关系结束：`deactivateCreatorRedemptionOnRelationshipEnd(tx, …)` 由 Family Access 在同一外层事务调用，不嵌套事务。
- 批准锁序：`lockRedemptionRow` → `lockStudentBalanceThenMonthlyUsage`（student FOR UPDATE → balance → monthly FOR UPDATE）。

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete
pnpm test tests/integration/redemption/redemption-lifecycle.test.ts tests/integration/api/m6-routes.test.ts tests/integration/migrations/m6-schema-constraints.test.ts tests/integration/family-access/multi-parent-authorization.test.ts tests/integration/settlement/settlement-ledger.test.ts tests/integration/outbox/outbox-transaction.test.ts tests/integration/audit/audit-coverage.test.ts → 7 files, 84 tests passed (~130s)
pnpm typecheck → exit 0
pnpm lint → exit 0 (6 pre-existing warnings, 0 errors)
pnpm format → exit 0
pnpm test (全量) → 4 failed / unrelated M5 tests (shared DB 并发干扰):
  - m5-training-constraints: duplicate active training definition (23505)
  - m5-concurrency x3: advisory lock timeout / cleanup race message mismatch
指令矩阵 84/84 通过；全量回归未全绿，失败项与 M6 整改范围无关。
```

## Blockers

- none（针对 P1-F01–F06 指令矩阵）
