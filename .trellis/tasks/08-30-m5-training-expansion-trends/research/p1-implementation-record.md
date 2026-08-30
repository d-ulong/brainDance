# M5 P1 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `9f0418814515d2165ebba90b1e98da274ec4eacd` |
| directive SHA | `dd35f215c83152bd3f0593ab42d281898245645b` |
| reviewed_implementation_SHA | `cd7dac3934daabf7dea22fb07df3dbc71801f9b9` |
| remediation_directive_SHA | `fecac3f4f1e4d149d3b310c08de001fc7dd814f5` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P1 consolidated remediation — not GO, not M5 complete |

Note: remediation commit SHA is reported in the Cursor handoff after submission; this record does not predeclare a final HEAD.

## Remediation resolved (P1-R01～P1-R07)

| R-ID | Summary |
|------|---------|
| P1-R01 | Session start replay and submit read fixed definition via `getSessionTrainingDefinition`; integration tests cover v1 snapshot after v2 activation and after all definitions deactivated |
| P1-R02 | `upsertProfileProjection` runs only when `sessionKind === "effective"`; integration test proves practice does not overwrite projection |
| P1-R03 | `m5-concurrency.test.ts` uses independent postgres connections and barrier synchronization for dual-session and same-session concurrent submit |
| P1-R04 | `0021_m5_definition_immutability.sql` trigger guards immutable fields and forbids reactivation; migration test covers freeze/deactivate/reactivate |
| P1-R05 | Shared `finalizeInvalidSession` commits status, submit key, and invalid audit in one transaction; audit spy rollback test proves no partial state |
| P1-R06 | Protocol validators reject unknown events; schema decoders require safe integers and finite time bounds; AC-M5-02/03 unit tests added |
| P1-R07 | Record corrected to reviewed SHA; lint warnings from new P1 code removed; AC mapping updated to real test names |

## Changed files (remediation)

- `src/modules/training/definition.service.ts`
- `src/modules/training/session.service.ts`
- `src/modules/training/reaction-v1.ts`
- `src/modules/training/stroop-v1.ts`
- `src/modules/training/digit-span-v1.ts`
- `src/modules/training/protocol.ts`
- `src/db/migrations/0021_m5_definition_immutability.sql`
- `src/db/migrations/meta/_journal.json`
- `tests/integration/training/m5-protocols.test.ts`
- `tests/integration/training/m5-concurrency.test.ts`
- `tests/integration/migrations/m5-training-constraints.test.ts`
- `tests/integration/migrations/m2-schema-constraints.test.ts`
- `tests/integration/migrations/m3-schema-constraints.test.ts`
- `tests/unit/training/reaction-v1.test.ts`
- `tests/unit/training/stroop-v1.test.ts`
- `tests/unit/training/digit-span-v1.test.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p1-implementation-record.md`

## R-M5 / AC-M5 coverage matrix (P1 scope, post-remediation)

| ID | Evidence |
|----|----------|
| R-M5-01 | `definition.service.ts` `getSessionTrainingDefinition`; `m5-protocols.test.ts` "P1-R01: start replay and submit use session definition snapshot after v1 deactivation" and "P1-R01: existing session replay and submit succeed when no active definition remains"; `m5-training-constraints.test.ts` "enforces immutable training definition fields at database level" |
| R-M5-02 | `stroop-v1.ts`; `stroop-v1.test.ts` AC-M5-02 cases; `m5-protocols.test.ts` Stroop completion + invalid median path |
| R-M5-03 | `digit-span-v1.ts`; `digit-span-v1.test.ts` AC-M5-03 cases; `m5-protocols.test.ts` digit-span completion |
| R-M5-04 | `session.service.ts` effective/practice gate + advisory lock; `training.test.ts` "marks second completed session on same day as practice"; `m5-concurrency.test.ts` "AC-M5-04: concurrent dual-session submit yields one effective and one practice" and "AC-M5-04: concurrent same-session submit with same idempotency key deduplicates side effects" |
| R-M5-08 | `m5-protocols.test.ts` "does not leak answers or full sequences in audit or outbox payloads" |
| AC-M5-01 | integration seed/start tests above |
| AC-M5-02 | `stroop-v1.test.ts` AC-M5-02 cases + Stroop integration invalid/completion tests |
| AC-M5-03 | `digit-span-v1.test.ts` AC-M5-03 cases + digit-span integration completion test |
| AC-M5-04 | `m5-concurrency.test.ts` AC-M5-04 concurrent tests; `training.test.ts` practice dedupe; `m5-protocols.test.ts` submit replay |

Out of P1 (not claimed): R-M5-05～07, AC-M5-05～10.

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | Migrations complete (applied `0021_m5_definition_immutability`) |
| `pnpm test tests/unit/training` | Test Files 4 passed; Tests 28 passed |
| `pnpm test tests/integration/migrations` | Test Files 6 passed; Tests 34 passed |
| `pnpm test tests/integration/training` | Test Files 4 passed; Tests 23 passed |
| `pnpm test tests/integration/outbox tests/integration/audit` | Test Files 3 passed; Tests 23 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 warnings (pre-existing in playwright.config.ts and scripts/run-e2e.mts) |
| `pnpm format` | All matched files use Prettier code style |
| `git diff --check cd7dac3934daabf7dea22fb07df3dbc71801f9b9..HEAD` | no conflicts |

## Unresolved / blockers

- none for P1 authorized remediation scope
- P2/P3 intentionally not started (trends, UI, E2E, AC-M5-05～10)
