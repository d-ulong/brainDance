# M5 P2 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `f43f4628b682df7991786bf77dc28993b5880844` |
| directive | `.trellis/tasks/08-30-m5-training-expansion-trends/research/p2-execution-directive.md` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P2 implementation — not GO, not M5 complete |

## R-M5 / AC-M5 coverage matrix (P2 scope)

| ID | Evidence |
|----|----------|
| R-M5-05 / AC-M5-05 | `trend-window.ts` + `trend-window.test.ts` (7d/30d/all Asia/Shanghai boundaries); `trends.service.ts` `queryTrainingTrends`; `m5-trends.test.ts` empty data, window/partialCoverage, definition-version and age-band segmentation; `m5-trends-routes.test.ts` typed DTO route |
| R-M5-05 / AC-M5-06 | `profile-projection-reducer.ts` shared best/last semantics; `session.service.ts` incremental upsert uses reducer; `trends.service.ts` `rebuildTrainingProfileProjectionForStudent`; `m5-trends.test.ts` incremental/rebuild parity + exclusion of practice/invalid/cancelled; `rebuild-training-projection.test.ts` idempotent rebuild + stale row removal |
| AC-M5-07 | `training-trends/route.ts` via `requireStudentReadAccess`; `m5-trends.test.ts` student self/cross-student + multi-parent end-relationship matrix; `m5-trends-routes.test.ts` student/parent/403/end-relationship HTTP paths |
| R-M5-08 | Unauthorized reads return 403 FORBIDDEN (not existence leak); invalid query returns VALIDATION_ERROR; digit-span attempt summaries rebuilt from authoritative events without leaking full sequences in trend DTO |

Out of P2 (not claimed): R-M5-06～07 UI, AC-M5-08～10, P3/E2E.

## Changed files

- `src/modules/training/profile-projection-reducer.ts`
- `src/modules/training/trend-window.ts`
- `src/modules/training/trends.service.ts`
- `src/modules/training/session.service.ts`
- `src/app/api/family/students/[studentId]/training-trends/route.ts`
- `tests/unit/training/trend-window.test.ts`
- `tests/integration/training/m5-trends.test.ts`
- `tests/integration/projection/rebuild-training-projection.test.ts`
- `tests/integration/api/m5-trends-routes.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p2-implementation-record.md`

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm test tests/unit/training` | Test Files 5 passed (5); Tests 44 passed (44) |
| `pnpm test tests/integration/training/m5-trends.test.ts` | Test Files 1 passed (1); Tests 9 passed (9) |
| `pnpm test tests/integration/training` | Test Files 1 failed \| 4 passed (5); Tests 1 failed \| 45 passed (46); sole failure pre-existing P1-R32 helper (`m5-concurrency.test.ts`), not P2 regression |
| `pnpm test tests/integration/projection` | Test Files 2 passed (2); Tests 8 passed (8) |
| `pnpm test tests/integration/api/m5-trends-routes.test.ts` | Test Files 1 passed (1); Tests 6 passed (6) |
| `pnpm test tests/integration/family-access` | exit 0 (all passed) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 pre-existing warnings |
| `pnpm format` | All matched files use Prettier code style |

## Unresolved / blockers

- Pre-existing P1 test helper failure `P1-R32: runner client close failure` in `m5-concurrency.test.ts` causes `pnpm test tests/integration/training` aggregate exit 1; explicitly out of P2 scope per collaboration rules (R35～R38 class non-blocking debt).
