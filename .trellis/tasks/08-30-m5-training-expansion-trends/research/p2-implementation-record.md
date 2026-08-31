# M5 P2 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `75190187b2dd39fc73c3622772fbcef0b4bf00ab` |
| directive | `.trellis/tasks/08-30-m5-training-expansion-trends/research/p2-consolidated-remediation-directive.md` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P2 consolidated remediation — not GO, not M5 complete, not P3 |

## P2 remediation coverage (P2-R01～P2-R03)

| ID | Evidence |
|----|----------|
| P2-R01 | `trends.service.ts` full `rebuildTrainingProfileProjection` deletes projections for students outside authoritative completed/effective set via `notInArray`; `rebuild-training-projection.test.ts` dual-student orphan cleanup, empty-source full wipe, existing idempotent/per-student stale-key tests |
| P2-R02 | `session.service.ts` `upsertProfileProjection` conflict update sets `windowSummary.lastFamilyDate` from reducer state; `m5-trends.test.ts` second effective session asserts last source session, last value, lower-is-better best retention, and `lastFamilyDate` parity after rebuild |
| P2-R03 | Both incremental (`upsertProfileProjection`) and rebuild (`rebuildTrainingProfileProjectionForStudent`) call shared `mergeMetricIntoProjectionState` via `buildProjectionStateFromRows`; `projectionRowsEquivalent` includes `lastFamilyDate`; `m5-trends.test.ts` excluded-metric and full row parity tests |

## R-M5 / AC-M5 coverage matrix (P2 scope)

| ID | Evidence |
|----|----------|
| R-M5-05 / AC-M5-05 | `trend-window.ts` + `trend-window.test.ts` (7d/30d/all Asia/Shanghai boundaries); `trends.service.ts` `queryTrainingTrends`; `m5-trends.test.ts` empty data, window/partialCoverage, definition-version and age-band segmentation; `m5-trends-routes.test.ts` typed DTO route |
| R-M5-05 / AC-M5-06 | `profile-projection-reducer.ts` shared `mergeMetricIntoProjectionState`; `session.service.ts` incremental upsert loads segment state and calls shared reducer; `trends.service.ts` rebuild uses same reducer; `m5-trends.test.ts` incremental/rebuild parity including `windowSummary.lastFamilyDate`; `rebuild-training-projection.test.ts` idempotent rebuild, orphan cleanup, stale row removal |
| AC-M5-07 | `training-trends/route.ts` via `requireStudentReadAccess`; `m5-trends.test.ts` student self/cross-student + multi-parent end-relationship matrix; `m5-trends-routes.test.ts` student/parent/403/end-relationship HTTP paths |
| R-M5-08 | Unauthorized reads return 403 FORBIDDEN (not existence leak); invalid query returns VALIDATION_ERROR; digit-span attempt summaries rebuilt from authoritative events without leaking full sequences in trend DTO |

Out of P2 (not claimed): R-M5-06～07 UI, AC-M5-08～10, P3/E2E.

## Changed files

- `src/modules/training/profile-projection-reducer.ts`
- `src/modules/training/trends.service.ts`
- `src/modules/training/session.service.ts`
- `tests/integration/training/m5-trends.test.ts`
- `tests/integration/projection/rebuild-training-projection.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p2-implementation-record.md`

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm test tests/unit/training` | Test Files 5 passed (5); Tests 44 passed (44) |
| `pnpm test tests/integration/training/m5-trends.test.ts` | Test Files 1 passed (1); Tests 11 passed (11) |
| `pnpm test tests/integration/projection` | Test Files 2 passed (2); Tests 10 passed (10) |
| `pnpm test tests/integration/api/m5-trends-routes.test.ts` | Test Files 1 passed (1); Tests 6 passed (6) |
| `pnpm test tests/integration/family-access` | Test Files 3 passed (3); Tests 28 passed (28) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 pre-existing warnings |
| `pnpm format` | All matched files use Prettier code style |

## Unresolved / blockers

- none
