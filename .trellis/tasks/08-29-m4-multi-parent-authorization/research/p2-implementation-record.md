# M4 P2 Implementation Record

> branch: `feat/m4-multi-parent-authorization`
>
> execution_baseline: `bb04d5bebe94e13c94a9433d5cd42aa34b7061c2`

## P2 交付范围

### 迁移与约束（0019）

- `daily_reflections`、`daily_reflection_versions`、`private_access_grants` append-only migration。
- `(student_id, family_date)` 未删除唯一；`(resource_type, resource_id, parent_id)` active grant 唯一；版本 `(reflection_id, version)` 唯一。

### Reflection Privacy module

- 学生当日总结 upsert/delete；普通总结 active parent 可读；私密总结需 active relationship + 未撤销 grant。
- 普通不可转私密；私密可转普通；新关联 parent 不自动读历史私密。
- grant/revoke 幂等 + audit/outbox；revoke/grant 递增 parent `authorization_epoch`。
- `grantPrivateAccess` 与 `endRelationship` 以相同稳定顺序锁定 parent/student 后再校验 active relationship，消除 grant/end TOCTOU。
- `endRelationship` 同事务调用 `revokePrivateGrantsOnRelationshipEnd`。

### Route / UI

- `GET/PUT/DELETE /api/students/[studentId]/daily-reflections/[familyDate]`
- `GET/POST /api/students/[studentId]/daily-reflections/[familyDate]/grants`
- `DELETE .../grants/[parentId]`
- `/student/reflection` 编辑/可见性/授权；`/parent/students/[studentId]/reflection` 只读。

## 整改项（P2 集中整改）

| ID | 修订 | 证据 |
| --- | --- | --- |
| P2-F01 | `grantPrivateAccess` 先 `lockUsersInOrder` 再校验 active relationship；grant/end 交错后无残留 active grant，重新关联不恢复历史可读权 | `reflection-privacy.test.ts` P2-F01 |
| P2-F02 | 并发读/撤权交错后 fresh read 拒绝且错误序列化不含正文 | `reflection-privacy.test.ts` P2-F02 |

## 验收矩阵

| ID | 覆盖 | 证据 |
| --- | --- | --- |
| AC-M4-4 | 私密总结逐家长 grant/revoke、无正文泄露 | `reflection-privacy.test.ts` P2-01～P2-09、P2-F01、P2-F02；`m4-routes.test.ts` P2-R01～R03；`m4-reflection-flow.spec.ts` |
| AC-M4-5 | grant/revoke/end 幂等、audit/outbox | P2-03、P2-04、P2-F01；end-relationship 扩展 |
| AC-M4-6 | Route 403/404、360px E2E | P2-R01～R03；desktop + mobile-360 E2E |
| P1 回归 | 多家长/end/epoch | 既有 `multi-parent-authorization.test.ts`、`m4-routes.test.ts` P1-R04 仍绿 |
| M1–M3 回归 | migration head、schema | m2/m3 head → `0019`；367 unit/integration tests |

## 质量门（串行，隔离 Docker Postgres）

| Command | Exit | Summary |
| --- | --- | --- |
| `pnpm db:migrate` | 0 | 0019 applied |
| `pnpm test` | 0 | **50 files / 367 tests** passed (~405s) |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 0 | 0 errors, 3 pre-existing warnings |
| `pnpm format` | 0 | All matched files use Prettier code style |
| `pnpm build` | 0 | next build OK |
| `pnpm test:e2e` | 0 | **14 passed** (1 worker, desktop + mobile-360, 2.0m) |

## Blocker

无。
