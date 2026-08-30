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
| third_remediation_directive_SHA | `0c232b76d1d9614a3eb1e943f08fbcc0a6bf8a56` |
| third_remediation_base | `da3a2ce3ed97719b87c8181be3a2ce898efad77c` |
| fourth_remediation_directive_SHA | `6d45ad8682e8f1ebbe4a5e18d736fd88e4c0c11f` |
| fourth_remediation_base | `7a13c0674adf0b6983f431471c37399f742c929a` |
| fifth_remediation_directive_SHA | `804930f3b85f60264b05c059d7c23cc0e88c2128` |
| fifth_remediation_base | `a309b4c021d7995f992ecb7bee8fc28ae687dff2` |
| sixth_remediation_directive_SHA | `0824195ab6707712bb492e7c52293964da206c70` |
| sixth_remediation_base | `d7dc70b9b2316cd0ef80df5c43231f63ca0bf5af` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P1 sixth-round remediation — not GO, not M5 complete |

Note: sixth-round remediation commit SHA is reported in the Cursor handoff after submission; this record does not predeclare a final HEAD.

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
| P1-R10 | Concurrent submit tests assert exact metric/audit/outbox counts; third-round R13 replaces pre-submit barrier with real submit advisory-lock contention evidence | `m5-concurrency.test.ts` P1-R10 / AC-M5-04 cases |
| P1-R11 | Forward migration `0022_m5_definition_active_lifecycle.sql` restricts active lifecycle transitions on UPDATE; third-round R15 adds `0023` domain CHECK | `0022_m5_definition_active_lifecycle.sql`; `m5-training-constraints.test.ts` |
| P1-R12 | Second-round record updated with remediation bases and verification summaries | this file (superseded by third-round section below for R13～R17) |

## Third-round remediation resolved (P1-R13～P1-R17)

| R-ID | Summary | Evidence |
|------|---------|----------|
| P1-R13 | `runConcurrentSubmitsWithContentionEvidence` gates the real submit advisory key, proves both submit backends wait then one holds/one waits via `pg_locks`, then asserts exact metric/audit/outbox counts; fourth-round R18/R19 harden bigint OID matching and bounded failure cleanup | `tests/helpers/training-submit-race.ts`; `m5-concurrency.test.ts` P1-R13 / P1-R18 / P1-R19 cases |
| P1-R14 | `isFiniteEventTime` rejects non-finite stimulus/response timestamps in Digit Span and Stroop before ordering checks; unit regressions for invalid stimulus and response times | `protocol-schema.ts`, `digit-span-v1.ts`, `stroop-v1.ts`; `digit-span-v1.test.ts`, `stroop-v1.test.ts` |
| P1-R15 | Forward migration `0023_m5_definition_active_domain.sql` pre-checks illegal rows and adds `CHECK (active IN (0,1))` on INSERT/UPDATE; trigger retains lifecycle rules | `0023_m5_definition_active_domain.sql`; `m5-training-constraints.test.ts` INSERT/UPDATE/`0→1`/`1→0` cases |
| P1-R16 | `isSafePositiveInt` uses `Number.isSafeInteger`; reaction/stroop/digit-span schema tests reject `MAX_SAFE_INTEGER + 1` | `protocol-schema.ts`; `reaction-v1.test.ts`, `stroop-v1.test.ts`, `digit-span-v1.test.ts` |
| P1-R17 | This record updated with third-round directive/base, accurate R13～R17 mapping, and verification summaries below | this file (superseded by fourth-round section below for R18～R22) |

## Fourth-round remediation resolved (P1-R18～P1-R22)

| R-ID | Summary | Evidence |
|------|---------|----------|
| P1-R18 | `readSubmitAdvisoryLockState` matches PostgreSQL bigint advisory-lock OID halves via `((hashtext::bigint >> 32) & mask)::oid`; fixed positive (`m5-lock-probe-1`) and negative (`m5-lock-probe-0`) hash regressions prove real submit-style backends are observable through the helper | `tests/helpers/training-submit-race.ts`; `m5-concurrency.test.ts` P1-R18 cases |
| P1-R19 | Gate lock release is tracked and runs before bounded runner settle on all failure paths; observation mismatch and runner early-failure regressions reject within explicit bounds with no leftover advisory locks; sixth-round R29 consolidates monitor try/finally via shared test helper | `tests/helpers/training-submit-race.ts`; `m5-concurrency.test.ts` P1-R19 cases |
| P1-R20 | Drizzle `trainingDefinitions` declares named check `training_definitions_active_domain` matching migration `0023`; metadata regression via `getTableConfig` | `src/db/schema/training.ts`; `m5-concurrency.test.ts` P1-R20 case |
| P1-R21 | Production `buildSubmitCompetitionLockKey` extracted to `submit-competition-lock-key.ts`; session service and contention helper share it | `src/modules/training/submit-competition-lock-key.ts`, `session.service.ts`, `training-submit-race.ts`; `m5-concurrency.test.ts` P1-R21 case |
| P1-R22 | This record updated with fourth-round directive/base, R18～R22 evidence, and verification summaries below | this file (superseded by fifth-round section below for R23～R25) |

## Fifth-round remediation resolved (P1-R23～P1-R25)

| R-ID | Summary | Evidence |
|------|---------|----------|
| P1-R23 | `GateLockPhase` single state replaces contradictory booleans; `released` only after confirmed `pg_advisory_unlock`; sixth-round R26 moves unlock-failure injection to post-observation unlock and R28 completes arbitrary thrown-value propagation | `tests/helpers/training-submit-race.ts`; superseded R23 mismatch-key cases replaced by P1-R26 |
| P1-R24 | R19 and cleanup-failure monitor connections wrapped in `try/finally`; sixth-round R29 extracts `assertBoundedRaceCleanupFailure` / `assertBoundedRaceRejection` | `m5-concurrency.test.ts` P1-R19 / P1-R26～R28 cases |
| P1-R25 | Fifth-round record updated with directive/base and verification summaries | this file (superseded by sixth-round section below for R26～R30) |

## Sixth-round remediation resolved (P1-R26～P1-R30)

| R-ID | Summary | Evidence |
|------|---------|----------|
| P1-R26 | `injectGateUnlockFailure` applies to post-observation `unlockGateAfterObservation`; runners wait on the same gate key; throw/false regressions assert unlock failure (not observation timeout) and prove bounded teardown with zero target locks | `tests/helpers/training-submit-race.ts`; `m5-concurrency.test.ts` P1-R26 throw/false cases |
| P1-R27 | `closeGateConnection` marks `closed` only after successful `gate.end()`; close failure surfaces as cleanup error; primary unlock failure plus forced close failure returns `AggregateError` with both errors | `tests/helpers/training-submit-race.ts`; `m5-concurrency.test.ts` P1-R27 case |
| P1-R28 | `caughtPrimary` flag replaces truthy `primaryError` check; `throw_undefined` regression proves rejection after cleanup; unsafe `result!` removed | `tests/helpers/training-submit-race.ts`; `m5-concurrency.test.ts` P1-R28 case |
| P1-R29 | `assertBoundedRaceCleanupFailure` and `assertBoundedRaceRejection` unify monitor lifecycle, elapsed bounds, and zero-lock assertions for four cleanup regressions | `m5-concurrency.test.ts` |
| P1-R30 | This record updated with sixth-round directive/base, R26～R30 evidence, and verification summaries below | this file |

## Changed files (sixth-round remediation)

- `tests/helpers/training-submit-race.ts`
- `tests/integration/training/m5-concurrency.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p1-implementation-record.md`

## Changed files (fifth-round remediation)

- `tests/helpers/training-submit-race.ts`
- `tests/integration/training/m5-concurrency.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p1-implementation-record.md`

## Changed files (fourth-round remediation)

- `src/modules/training/submit-competition-lock-key.ts`
- `src/modules/training/session.service.ts`
- `src/db/schema/training.ts`
- `tests/helpers/training-submit-race.ts`
- `tests/integration/training/m5-concurrency.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p1-implementation-record.md`

## Changed files (third-round remediation)

- `src/modules/training/protocol-schema.ts`
- `src/modules/training/digit-span-v1.ts`
- `src/modules/training/stroop-v1.ts`
- `src/db/migrations/0023_m5_definition_active_domain.sql`
- `src/db/migrations/meta/_journal.json`
- `tests/helpers/training-submit-race.ts`
- `tests/unit/training/reaction-v1.test.ts`
- `tests/unit/training/stroop-v1.test.ts`
- `tests/unit/training/digit-span-v1.test.ts`
- `tests/integration/training/m5-concurrency.test.ts`
- `tests/integration/migrations/m5-training-constraints.test.ts`
- `tests/integration/migrations/m2-schema-constraints.test.ts`
- `tests/integration/migrations/m3-schema-constraints.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p1-implementation-record.md`

## R-M5 / AC-M5 coverage matrix (P1 scope, post fourth-round remediation)

| ID | Evidence |
|----|----------|
| R-M5-01 | `definition.service.ts` `getSessionTrainingDefinition`; `m5-protocols.test.ts` P1-R01 cases; `m5-training-constraints.test.ts` immutable fields + active domain/lifecycle; Drizzle check metadata P1-R20 |
| R-M5-02 | `stroop-v1.ts` finite event times; `stroop-v1.test.ts` AC-M5-02 cases (unknown/duplicate/invalid time/wrong answers); `m5-protocols.test.ts` Stroop completion + invalid median path |
| R-M5-03 | `digit-span-v1.ts` finite event times; `digit-span-v1.test.ts` AC-M5-03 cases (duplicate/invalid time/wrong answers); `m5-protocols.test.ts` digit-span completion |
| R-M5-04 | `session.service.ts` effective/practice gate + shared advisory lock key; `training.test.ts` practice dedupe; `m5-concurrency.test.ts` P1-R13 concurrent tests with hardened pg_locks contention + exact side-effect counts |
| R-M5-08 | `m5-protocols.test.ts` audit/outbox payload redaction test |
| AC-M5-01 | integration seed/start tests above |
| AC-M5-02 | `stroop-v1.test.ts` AC-M5-02 matrix + Stroop integration tests |
| AC-M5-03 | `digit-span-v1.test.ts` AC-M5-03 matrix + digit-span integration completion test |
| AC-M5-04 | `m5-concurrency.test.ts` P1-R13 concurrent dual-session and idempotency tests |

Out of P1 (not claimed): R-M5-05～07, AC-M5-05～10.

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | Migrations complete |
| `pnpm test tests/unit/training` | Test Files 4 passed; Tests 41 passed |
| `pnpm test tests/integration/migrations` | Test Files 6 passed; Tests 35 passed |
| `pnpm test tests/integration/training` | Test Files 4 passed; Tests 33 passed (includes P1-R18～R21 and P1-R26～R28 regressions) |
| `pnpm test tests/integration/outbox tests/integration/audit` | Test Files 3 passed; Tests 23 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 warnings (pre-existing in playwright.config.ts and scripts/run-e2e.mts) |
| `pnpm format` | All matched files use Prettier code style |
| `git diff --check d7dc70b9b2316cd0ef80df5c43231f63ca0bf5af..HEAD` | no conflicts (run after commit) |

## Unresolved / blockers

- none anticipated for P1 authorized sixth-round scope
- P2/P3 intentionally not started (trends, UI, E2E, AC-M5-05～10)
