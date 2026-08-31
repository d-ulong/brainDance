# M6 P1 实施记录

## 范围映射

| 要求 ID | 实现要点 | 主要文件 | 测试证据 |
|---------|---------|---------|---------|
| P1-R01 | `redemption_catalog_items`、`point_redemptions` schema/migration；ledger 扩展 `redemption` source；约束测试 | `src/db/schema/redemption.ts`, `0024_m6_redemption.sql`, `0025_m6_ledger_source_check.sql` | `tests/integration/migrations/m6-schema-constraints.test.ts` |
| P1-R02 | 创建家长独占编辑；扩展 `deactivateCreatorConfigsOnRelationshipEnd` 停用目录并取消 pending | `catalog.service.ts`, `deactivate-creator-configs.service.ts` | `redemption-lifecycle.test.ts` 离关联用例 |
| P1-R03 | pending→approved/rejected/cancelled 状态机；Idempotency-Key 重放/冲突 | `redemption.service.ts` | 幂等、撤销、拒绝用例 |
| P1-R04 | 批准锁序：redemption FOR UPDATE → student FOR UPDATE → 月限次；唯一负向 ledger | `redemption.service.ts`, `ledger-redemption.service.ts` | 并发批准/拒绝、余额、ledger 唯一性用例 |
| P1-R05 | 薄 Route + DTO/错误映射 | `src/app/api/family/students/.../redemption-*`, `m6-schemas.ts`, `to-route-error-response.ts` | `tests/integration/api/m6-routes.test.ts` |
| R-M6-01 | 目录所有权、离关联停用、cost_snapshot | catalog + deactivate | lifecycle 快照/离关联/非创建家长编辑 |
| R-M6-02 | 状态机、唯一扣减、余额/月限次 | redemption + ledger-redemption | lifecycle 全套 |
| AC-M6-01 | 所有权/快照/月限次/并发 | 同上 | lifecycle + m6 constraints |
| AC-M6-02 | 批准唯一流水、余额不足/负数、终态冲突 | 同上 | lifecycle 并发与余额用例 |

## 数据不变量

- **redemption_catalog_items**：`cost > 0`；`monthly_limit` 为 NULL 或正整数；`(creator_parent_id, create_idempotency_key)` 唯一。
- **point_redemptions**：`cost_snapshot > 0`；`request_month` 格式 `YYYY-MM`；状态 check + 终态字段组合 check；approved 必须带 `ledger_entry_id`；`(student_id, create_idempotency_key)` 唯一；`ledger_entry_id` 部分唯一。
- **point_ledger_entries**：扩展 `source_type='redemption'`（`settlement_id` NULL、`amount < 0`）；`settlement_id` 可空；部分唯一 `(settlement_id) WHERE NOT NULL` 与 `(source_id) WHERE redemption`。
- **批准锁顺序**：`point_redemptions` 行锁 → `users` 学生行锁（余额投影）→ 同 catalog+月 pending/approved 行锁 → insert ledger → update approved。

## 权限与并发

- 学生：只读 active 目录、创建/撤销自己的 pending。
- 创建家长：CRUD 自己创建的目录项；批准/拒绝需 active relationship。
- 其他家长：只读；不可编辑他人目录。
- 已解除家长：403；跨学生路径不泄露存在性（404/403 矩阵）。
- 并发批准×批准、批准×拒绝：至多一个终态、至多一条扣减流水。

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete (0024, 0025 applied)
pnpm test tests/integration/migrations tests/integration/settlement tests/integration/redemption tests/integration/api tests/integration/family-access tests/integration/outbox tests/integration/audit → 21 files, 224 tests passed
pnpm typecheck → exit 0
pnpm lint → exit 0
pnpm format → exit 0
```

## Blockers

- none
