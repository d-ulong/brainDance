# M5 P2 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `829e75806fdd90e8a42fa0cb27106beaa2685443` |
| directive | `.trellis/tasks/08-30-m5-training-expansion-trends/research/p2-final-concurrency-remediation-directive.md` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P2 final concurrency remediation — not GO, not M5 complete, not P3 |

## P2-R04 — full rebuild / submit projection coordination

| Item | Detail |
|------|--------|
| Root cause | Full rebuild enumerated authoritative students outside the transaction, then deleted orphan projections via `NOT IN` using that stale in-memory set while concurrent effective submits could insert new projection rows. |
| Fix | Move authoritative `SELECT DISTINCT student_id`, per-student reduction, and orphan cleanup into one transaction after acquiring `pg_advisory_xact_lock(hashtext(buildFullRebuildProjectionLockKey()))`. Submit transactions acquire the same full-rebuild lock before the existing submit-competition lock. |
| Lock order | 1) `training:profile-projection:full-rebuild` (`buildFullRebuildProjectionLockKey`) → 2) `${studentId}:${trainingKey}:${familyDate}` (`buildSubmitCompetitionLockKey`). Full rebuild holds only lock 1; submit holds lock 1 then lock 2. No path acquires lock 2 without lock 1, avoiding deadlock with rebuild. |
| Deterministic race | `rebuild-training-projection.test.ts` pauses production full rebuild at `beforeOrphanCleanup` while a first effective submit for a previously absent student blocks on lock 1; after gate release both finish with authoritative session retained, projection present, and parity vs per-student rebuild. Bounded by 15s timeout. |

## P2 remediation regression (P2-R01～P2-R03 unchanged)

| ID | Evidence |
|----|----------|
| P2-R01 | `rebuild-training-projection.test.ts` dual-student orphan cleanup, empty-source full wipe, idempotent/per-student stale-key tests — all pass after P2-R04 |
| P2-R02 | `m5-trends.test.ts` second effective session asserts last source session, last value, lower-is-better best retention, and `lastFamilyDate` parity after rebuild |
| P2-R03 | Shared `mergeMetricIntoProjectionState` via `buildProjectionStateFromRows`; `projectionRowsEquivalent` includes `lastFamilyDate`; `m5-trends.test.ts` excluded-metric and full row parity tests |

## Changed files

- `src/modules/training/submit-competition-lock-key.ts`
- `src/modules/training/trends.service.ts`
- `src/modules/training/session.service.ts`
- `tests/integration/projection/rebuild-training-projection.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p2-implementation-record.md`

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm test tests/integration/projection` | Test Files 2 passed (2); Tests 11 passed (11) |
| `pnpm test tests/integration/training/m5-trends.test.ts` | Test Files 1 passed (1); Tests 11 passed (11) |
| `pnpm test tests/integration/api/m5-trends-routes.test.ts` | Test Files 1 passed (1); Tests 6 passed (6) |
| `pnpm test tests/integration/family-access` | Test Files 3 passed (3); Tests 28 passed (28) |
| `pnpm test tests/unit/training` | Test Files 5 passed (5); Tests 44 passed (44) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 pre-existing warnings |
| `pnpm format` | All matched files use Prettier code style |

## Unresolved / blockers

- none
