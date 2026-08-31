# M6 P1 最终验收修正记录（C01–C02）

## 修正映射

| 阻断项 | 整改要点 | 主要文件 | 测试证据 |
|--------|---------|---------|---------|
| C01 / P1-F01 | catalog create 并发幂等改用 `onConflictDoNothing`，避免 aborted 事务内查询 | `catalog.service.ts` | `P1-F01: concurrent catalog create with same idempotency key converges without 500` |
| C02 / P1-F06 | 月限次真实并发竞争；create 路径 advisory lock 串行化月限检查；补齐 Route 矩阵单元格 | `redemption.service.ts`, `redemption-lifecycle.test.ts`, `m6-routes.test.ts` | 见下表 |

## 验收矩阵（测试名称 → 要求）

| 测试名称 | 覆盖要求 |
|---------|---------|
| `P1-F01: concurrent catalog create with same idempotency key converges without 500` | C01：并发 create 幂等收敛、无 500、事实/audit/outbox 各一套 |
| `enforces monthly limit` | 月限次顺序基线 |
| `AC-M6-01: concurrent create at monthly limit allows only one new request` | C02：独立连接并发月限次竞争 |
| `concurrent approve yields one terminal state and one deduction` | 批准×批准（含 monthlyLimit=1） |
| `concurrent approve and reject yields one terminal state` | 批准×拒绝 |
| `AC-M6-02: concurrent approve and cancel yields one terminal state` | 批准×撤销 |
| `AC-M6-01: Asia/Shanghai requestMonth boundary at month rollover` | 月末/月初 requestMonth 边界 |
| `AC-M6-01: ending one parent relationship preserves other parent catalog access` | 双 parent 结束一个关系 |
| `AC-M6-01: ending one student relationship preserves other student catalog` | 双 student 结束一个关系 |
| `P1-F03: student cannot read inactive catalog even with activeOnly=false query` | 学生 inactive 过滤 |
| `route matrix: creating parent can create and update own catalog` | catalog create/update 创建家长 |
| `route matrix: other valid parent cannot update creator catalog` | 其他有效家长 |
| `route matrix: unauthenticated access returns 401 on all m6 routes` | 每条 Route 缺身份 header |
| `route matrix: cross-student access returns forbidden on all studentId routes` | 每条带 studentId Route 跨学生 |
| `route matrix: ended relationship blocks parent catalog and redemption command routes` | 需要有效家庭关系的 Route 关系已解除 |
| `route matrix: unknown resource IDs return not found on command routes` | update/cancel/approve/reject unknown ID |
| `route matrix: invalid DTO returns 400 on body routes` | create/update/reject 非法 DTO |
| `route matrix: write routes require Idempotency-Key header` | 写 Route 缺 Idempotency-Key |
| `returns 403 when parent accesses another student catalog write` | catalog create 跨学生（复用） |
| `route matrix: cross-student redemption write returns forbidden` | redemption create 跨学生（复用） |
| `ended parent cannot approve redemption` | approve 解除家长（复用） |
| `route matrix: student create/cancel and parent reject with validation errors` | create unknown ID / reject 非法 DTO（复用） |
| `route matrix: parent cannot cancel student redemption; student cannot approve` | 角色矩阵 student/家长（复用） |
| `student and parent can read catalog; student can request and parent approve` | 学生/家长成功路径（复用） |
| `P1-F01: rolls back catalog create when audit append fails` | 原子回滚（audit） |
| `P1-F01: rolls back catalog update when outbox append fails` | 原子回滚（outbox） |
| `P1-F04: catalog update replays same payload and conflicts on different payload` | update payload 冲突 |
| `P1-F04: reject replays same payload and conflicts on different reason` | reject payload 冲突 |

## 事务、模块边界与锁序

- catalog create：事务内 `onConflictDoNothing` 插入；冲突后在同一有效事务中查询 replay，仅首次写入 append audit/outbox。
- 其余 P1 已闭合项保持不变。

## 验证原始摘要

```text
pnpm db:migrate → Migrations complete
pnpm test tests/integration/redemption/redemption-lifecycle.test.ts tests/integration/api/m6-routes.test.ts tests/integration/migrations/m6-schema-constraints.test.ts tests/integration/family-access/multi-parent-authorization.test.ts tests/integration/settlement/settlement-ledger.test.ts tests/integration/outbox/outbox-transaction.test.ts tests/integration/audit/audit-coverage.test.ts → 7 files, 91 tests passed (~157s)
pnpm typecheck → exit 0
pnpm lint → exit 0 (5 pre-existing warnings, 0 errors)
pnpm format → exit 0
```

## Blockers

- none（针对 C01–C02）
