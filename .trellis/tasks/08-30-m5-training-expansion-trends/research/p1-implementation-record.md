# M5 P1 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `9f0418814515d2165ebba90b1e98da274ec4eacd` |
| directive SHA | `dd35f215c83152bd3f0593ab42d281898245645b` |
| reviewed_implementation_SHA | `cd7dac3934daabf7dea22fb07df3dbc71801f9b9` |
| first_remediation_directive_SHA | `fecac3f4f1e4d149d3b310c08de001fc7dd814f5` |
| first_remediation_base | `cd7dac3934daabf7dea22fb07df3dbc71801f9b9` |
| second_remediation_directive_SHA | `adbe91f3c6d1bdf8f4ca16a7a45b3455b7f3db3e` |
| second_remediation_base | `920851003b1d5bfe3cf7e5eae1265e38656cbe92` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P1 second-round remediation — not GO, not M5 complete |

Note: second-round remediation commit SHA is reported in the Cursor handoff after submission; this record does not predeclare a final HEAD.

## First-round remediation resolved (P1-R01～P1-R07)

| R-ID | Summary |
|------|---------|
| P1-R01 | Session start replay and submit read fixed definition via `getSessionTrainingDefinition`; integration tests cover v1 snapshot after v2 activation and after all definitions deactivated |
| P1-R02 | `upsertProfileProjection` runs only when `sessionKind === "effective"`; integration test proves practice does not overwrite projection |
| P1-R03 | First pass added independent postgres connections and barrier synchronization (second-round R10 tightens DB-window and exact-count evidence) |
| P1-R04 | First pass added `0021_m5_definition_immutability.sql` (second-round R11 adds `0022` active lifecycle guard) |
| P1-R05 | Shared `finalizeInvalidSession` commits status, submit key, and invalid audit in one transaction; audit spy rollback test proves no partial state |
| P1-R06 | First pass added protocol validators and focused unit tests (second-round R09 completes Stroop/Digit Span matrix and Digit Span time invariants) |
| P1-R07 | Record corrected to reviewed SHA; lint warnings from new P1 code removed; AC mapping updated to real test names |

## Second-round remediation resolved (P1-R08～P1-R12)

| R-ID | Summary | Evidence |
|------|---------|----------|
| P1-R08 | Shared `isSafePositiveInt` extracted to `protocol-schema.ts`; reaction/stroop/digit-span decoders reuse it | `src/modules/training/protocol-schema.ts`; existing decoder unit tests |
| P1-R09 | Digit Span validates response-after-stimulus time; Stroop rejects non-positive reaction intervals; Stroop/Digit Span unit tests cover duplicate response, wrong answers, negative time | `digit-span-v1.ts`, `stroop-v1.ts`; `stroop-v1.test.ts` AC-M5-02 cases; `digit-span-v1.test.ts` AC-M5-03 cases |
| P1-R10 | `assertCompetitionAdvisoryLockContention` proves real submit advisory-key blocking; concurrent submit tests use DB witness + `waitAllArmed` and assert exact metric/audit/outbox counts | `tests/helpers/training-submit-race.ts`; `m5-concurrency.test.ts` P1-R10 cases |
| P1-R11 | Forward migration `0022_m5_definition_active_lifecycle.sql` restricts active to unchanged or `1 → 0`; migration test covers all four immutable fields plus illegal active values/transitions | `0022_m5_definition_active_lifecycle.sql`; `m5-training-constraints.test.ts` |
| P1-R12 | This record updated with both remediation bases, accurate R08～R12 mapping, and verification summaries below | this file |

## Changed files (second-round remediation)

- `src/modules/training/protocol-schema.ts`
- `src/modules/training/reaction-v1.ts`
- `src/modules/training/stroop-v1.ts`
- `src/modules/training/digit-span-v1.ts`
- `src/db/migrations/0022_m5_definition_active_lifecycle.sql`
- `src/db/migrations/meta/_journal.json`
- `tests/helpers/training-submit-race.ts`
- `tests/unit/training/stroop-v1.test.ts`
- `tests/unit/training/digit-span-v1.test.ts`
- `tests/integration/training/m5-concurrency.test.ts`
- `tests/integration/migrations/m5-training-constraints.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p1-implementation-record.md`

## R-M5 / AC-M5 coverage matrix (P1 scope, post second-round remediation)

| ID | Evidence |
|----|----------|
| R-M5-01 | `definition.service.ts` `getSessionTrainingDefinition`; `m5-protocols.test.ts` P1-R01 cases; `m5-training-constraints.test.ts` immutable fields + active lifecycle |
| R-M5-02 | `stroop-v1.ts`; `stroop-v1.test.ts` AC-M5-02 cases (unknown/duplicate/negative time/wrong answers); `m5-protocols.test.ts` Stroop completion + invalid median path |
| R-M5-03 | `digit-span-v1.ts` time invariants; `digit-span-v1.test.ts` AC-M5-03 cases (duplicate/time/wrong answers); `m5-protocols.test.ts` digit-span completion |
| R-M5-04 | `session.service.ts` effective/practice gate + advisory lock; `training.test.ts` practice dedupe; `m5-concurrency.test.ts` P1-R10 / AC-M5-04 concurrent tests with exact side-effect counts |
| R-M5-08 | `m5-protocols.test.ts` audit/outbox payload redaction test |
| AC-M5-01 | integration seed/start tests above |
| AC-M5-02 | `stroop-v1.test.ts` AC-M5-02 matrix + Stroop integration tests |
| AC-M5-03 | `digit-span-v1.test.ts` AC-M5-03 matrix + digit-span integration completion test |
| AC-M5-04 | `m5-concurrency.test.ts` P1-R10 concurrent dual-session and idempotency tests |

Out of P1 (not claimed): R-M5-05～07, AC-M5-05～10.

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | Migrations complete (applied `0022_m5_definition_active_lifecycle`) |
| `pnpm test tests/unit/training` | Test Files 4 passed; Tests 34 passed |
| `pnpm test tests/integration/migrations` | Test Files 6 passed; Tests 34 passed |
| `pnpm test tests/integration/training` | Test Files 4 passed; Tests 24 passed |
| `pnpm test tests/integration/outbox tests/integration/audit` | Test Files 3 passed; Tests 23 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 warnings (pre-existing in playwright.config.ts and scripts/run-e2e.mts) |
| `pnpm format` | All matched files use Prettier code style |
| `git diff --check 920851003b1d5bfe3cf7e5eae1265e38656cbe92..HEAD` | no conflicts (run after commit) |

## Unresolved / blockers

- none anticipated for P1 authorized second-round scope
- P2/P3 intentionally not started (trends, UI, E2E, AC-M5-05～10)
