# Phase 5 Implementation Record — Route Handlers

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Execution baseline：`070bb95b8a9fbc0d2836e77df189ec2fb5a8afeb`
> 阶段：implement §1 Phase 5
> 状态：已交 Codex 审核（非 GO）

## 1. 实现范围

### M2 Route Handlers（design.md §7）

| 方法 | 路径 | 实现文件 |
| --- | --- | --- |
| POST | `/api/family/students/[studentId]/formal-plans` | `src/app/api/family/students/[studentId]/formal-plans/route.ts` |
| POST | `/api/family/students/[studentId]/formal-plans/maintain-horizon` | `.../maintain-horizon/route.ts` |
| GET | `/api/family/students/[studentId]/formal-plans/current` | `.../current/route.ts` |
| PATCH | `/api/formal-plans/[planId]` | `src/app/api/formal-plans/[planId]/route.ts` |
| POST | `/api/formal-plans/[planId]/deactivate` | `.../deactivate/route.ts` |
| GET | `/api/family/students/[studentId]/schedule-items` | `.../schedule-items/route.ts` |
| POST | `/api/schedule-items/[itemId]/complete` | `src/app/api/schedule-items/[itemId]/complete/route.ts` |
| POST | `/api/schedule-items/[itemId]/skip` | `.../skip/route.ts` |
| POST | `/api/family/students/[studentId]/point-rules` | `.../point-rules/route.ts` |
| GET | `/api/family/students/[studentId]/points/balance` | `.../points/balance/route.ts` |
| GET | `/api/family/students/[studentId]/points/ledger` | `.../points/ledger/route.ts` |

### 共享适配

- `src/app/api/_lib/require-idempotency-key.ts` — 七类写 Route 鉴权前校验 `Idempotency-Key`
- `src/app/api/_lib/to-route-error-response.ts` — Schedule/Settlement/Zod → HTTP 稳定映射
- `src/app/api/_lib/m2-schemas.ts` — Zod DTO
- `src/app/api/_lib/student-read-access.ts` — 家长/学生读授权
- `src/app/api/_lib/m2-read-queries.ts` — GET current plan / balance / ledger 只读查询

## 2. 测试证据

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/integration/api/write-route-idempotency-header.test.ts` | F23 / AC-M2-F23：七类写 Route 缺/空白 header → 400 `IDEMPOTENCY_KEY_REQUIRED`；domain spy 未调用 |
| `tests/integration/api/m2-routes.test.ts` | 成功路径、403 鉴权、400 DTO、409 领域冲突、GET 只读（NF-4/F5）、complete+balance 链路 |

## 3. 验证矩阵更新

| ID | 证据 |
| --- | --- |
| F23 | `write-route-idempotency-header.test.ts`（7 tests） |
| NF-3 | 同上 |
| NF-4 | `m2-routes.test.ts` GET 零写库断言 |
| NF-7 | GET/mount 路径无 maintain-horizon 调用（路由层未引入） |

## 4. 验证命令（提交前）

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/integration/api` | exit 0；2 files；14 tests passed |
| `pnpm test` | exit 0；40 files；223 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；0 errors；3 个既有 warnings |
| `pnpm format` | exit 0；All matched files use Prettier code style |
| `pnpm build` | exit 0；production build completed |

## 5. 未覆盖（Phase 5 范围外）

- Phase 6 Web UI
- Phase 7 E2E
- 最终验收矩阵全绿（Phase 8）
