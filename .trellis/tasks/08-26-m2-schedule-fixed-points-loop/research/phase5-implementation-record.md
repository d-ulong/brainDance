# Phase 5 Implementation Record — Route Handlers

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Remediation baseline：`34218a18976b6e1084daec0c278fe823df307e91`
> 阶段：Phase 5 Round 1 Consolidated Remediation
> 状态：已交 Codex 复审（非 GO）

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
| POST | `/api/schedule-items/[itemId]/complete` | `.../complete/route.ts` |
| POST | `/api/schedule-items/[itemId]/skip` | `.../skip/route.ts` |
| POST | `/api/family/students/[studentId]/point-rules` | `.../point-rules/route.ts` |
| GET | `/api/family/students/[studentId]/points/balance` | `.../points/balance/route.ts` |
| GET | `/api/family/students/[studentId]/points/ledger` | `.../points/ledger/route.ts` |

### 共享适配

- `src/app/api/_lib/require-idempotency-key.ts` — 七类写 Route 鉴权前校验；有效 key 原样传递
- `src/app/api/_lib/to-route-error-response.ts` — 嵌套 `{ error: { code, message } }` envelope；legacy 委派 `toErrorResponse`
- `src/app/api/_lib/m2-schemas.ts` — Zod DTO + `m2UuidParamSchema`
- `src/app/api/_lib/student-read-access.ts` — 家长/学生读授权

### 模块查询接口（P5-R05）

- `src/modules/schedule/schedule-query.service.ts` — `queryCurrentFormalPlan`
- `src/modules/settlement/ledger.service.ts` — `queryPointsBalance`、`queryPointsLedger`

## 2. 11 Route 验收矩阵（P5-R06）

| Route | 成功路径 | 鉴权拒绝 | DTO/参数 400 | 领域错误映射 | 只读/幂等专项 |
| --- | --- | --- | --- | --- | --- |
| POST formal-plans | `creates formal plan (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid body` + `invalid studentId path param` | `maps active plan conflict to 409` | F23（14 cases + 7 passthrough） |
| POST maintain-horizon | `maintains horizon (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid studentId path param` | — | F23 |
| GET current | `returns current plan (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid studentId and skips query` | — | `GET read-only invariant` |
| PATCH formal-plans | `edits formal plan (success path)` | `returns 403 for unrelated parent (auth)` | `returns 400 for invalid body` + `invalid planId path param` | `returns 404 for unknown planId` | F23 |
| POST deactivate | `deactivates formal plan (success path)` | `returns 403 for unrelated parent (auth)` | — | `returns 404 for unknown planId` | F23 |
| GET schedule-items | `lists schedule items (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid query` | — | `GET read-only invariant` |
| POST complete | `completes schedule item (success path)` | `returns 403 when parent attempts complete (auth)` | `returns 400 for invalid itemId path param` | `returns 404 for unknown itemId` | F23 |
| POST skip | `skips schedule item (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid itemId path param` | — | F23 |
| POST point-rules | `enables point rule (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid body` | `maps duplicate enable to 409` | F23 |
| GET balance | `returns balance after completion (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid studentId and skips query` | — | `GET read-only invariant` |
| GET ledger | `returns ledger entries (success path)` | `returns 403 for unrelated student (auth)` | `returns 400 for invalid limit query` + `invalid studentId and skips query` | — | `GET read-only invariant` |

## 3. 整改项状态

| ID | 状态 | 证据 |
| --- | --- | --- |
| P5-R01 | 完成 | 嵌套 envelope；`toRouteErrorResponse` + `requireIdempotencyKey` + API 测试断言 |
| P5-R02 | 完成 | `require-idempotency-key.ts` 返回 raw；7 Route passthrough spy 测试 |
| P5-R03 | 完成 | `write-route-idempotency-header.test.ts` 14 组合（7×2） |
| P5-R04 | 完成 | `m2UuidParamSchema`；studentId/planId/itemId 非法 UUID → 400 |
| P5-R05 | 完成 | 删除 `m2-read-queries.ts`；查询归入 Schedule/Settlement 模块 |
| P5-R06 | 完成 | 上表 11 Route 矩阵；`m2-routes.test.ts` 41 tests |
| P5-R07 | 完成 | legacy 错误委派 `toErrorResponse` + `flatToNested` |
| P5-R08 | 完成 | 删除 `loginAsParent`/`loginAsStudent` |

## 4. 验证命令（提交前）

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/integration/api` | exit 0；2 files；62 tests passed |
| `pnpm test` | exit 0；40 files；271 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；0 errors；3 个既有 warnings |
| `pnpm format` | exit 0；All matched files use Prettier code style |
| `pnpm build` | exit 0；production build completed |

## 5. 未覆盖（Phase 5 范围外）

- Phase 6 Web UI
- Phase 7 E2E
- 最终验收矩阵全绿（Phase 8）
