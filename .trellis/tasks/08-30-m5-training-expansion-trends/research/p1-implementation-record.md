# M5 P1 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `9f0418814515d2165ebba90b1e98da274ec4eacd` |
| directive SHA | `dd35f215c83152bd3f0593ab42d281898245645b` |
| branch | `feat/m5-training-expansion-trends` |
| final HEAD | `04dd7f90c429e2c02518bba6bb8157a0f71c5959` |
| stage | P1 only — not GO, not M5 complete |

## Changed files

- `src/modules/training/protocol.ts`
- `src/modules/training/stroop-v1.ts`
- `src/modules/training/digit-span-v1.ts`
- `src/modules/training/constants.ts`
- `src/modules/training/reaction-v1.ts`
- `src/modules/training/definition.service.ts`
- `src/modules/training/session.service.ts`
- `src/db/schema/training.ts`
- `src/db/migrations/0020_m5_training_constraints.sql`
- `src/db/migrations/meta/_journal.json`
- `scripts/seed-m1.ts`
- `scripts/e2e-bootstrap.ts`
- `tests/unit/training/stroop-v1.test.ts`
- `tests/unit/training/digit-span-v1.test.ts`
- `tests/integration/training/m5-protocols.test.ts`
- `tests/integration/migrations/m5-training-constraints.test.ts`
- `tests/integration/migrations/m2-schema-constraints.test.ts`
- `tests/integration/migrations/m3-schema-constraints.test.ts`
- `tests/integration/training/training.test.ts`
- `tests/helpers/training.ts`

## R-M5 / AC-M5 coverage matrix (P1 scope)

| ID | Evidence |
|----|----------|
| R-M5-01 | `definition.service.ts` `seedStroopDefinitions` / `seedDigitSpanDefinitions`; `m5-protocols.test.ts` "seeds active Stroop and digit-span definitions for all age bands" |
| R-M5-02 | `stroop-v1.ts`; `stroop-v1.test.ts`; `m5-protocols.test.ts` Stroop completion + invalid median path |
| R-M5-03 | `digit-span-v1.ts`; `digit-span-v1.test.ts`; `m5-protocols.test.ts` digit-span completion |
| R-M5-04 | existing effective/practice + `m5-protocols.test.ts` triple-key effective + submit idempotency |
| R-M5-08 | `m5-protocols.test.ts` "does not leak answers or full sequences in audit or outbox payloads"; existing `audit-coverage.test.ts` still passes |
| AC-M5-01 | integration seed/start tests above |
| AC-M5-02 | `stroop-v1.test.ts` + Stroop integration invalid/completion tests |
| AC-M5-03 | `digit-span-v1.test.ts` + digit-span integration completion test |
| AC-M5-04 | `training.test.ts` practice dedupe + `m5-protocols.test.ts` triple effective + submit replay |

Out of P1 (not claimed): R-M5-05～07, AC-M5-05～10.

## Definition parameters (v1, stored in `metric_schema`)

Source: frozen metric semantics from PRD/design/CONTEXT; numeric session parameters chosen as minimal fixed standard values per age band (D-M5-01), stored in definition seed — not UI-hardcoded.

### Stroop (`stroop`, version 1)

| age_band | trialCount | congruentQuota | incongruentQuota | minValidMs | maxValidMs | colors |
|----------|------------|----------------|------------------|------------|------------|--------|
| 5-8 | 12 | 6 | 6 | 300 | 5000 | red, blue, green, yellow |
| 9-12 | 16 | 8 | 8 | 200 | 4000 | red, blue, green, yellow |
| 13-18 | 20 | 10 | 10 | 150 | 3000 | red, blue, green, yellow |

Rationale: shorter/slower-bound sessions for younger bands; classic four-color Stroop set; quotas balanced; RT bounds align with reaction training pattern (exclude implausible times without faking medians).

### Digit span (`digit-span`, version 1)

| age_band | forwardMin→Max | backwardMin→Max | attemptsPerLength |
|----------|----------------|-----------------|-------------------|
| 5-8 | 2→4 | 2→3 | 2 |
| 9-12 | 2→5 | 2→4 | 2 |
| 13-18 | 3→6 | 2→5 | 2 |

Rationale: fixed ladders per band without cross-day adaptive state; two attempts per length; forward/backward separated for distinct max-span metrics.

## Schema decision

| Invariant | Decision | Evidence |
|-----------|----------|----------|
| One effective completed session per `(student_id, training_key, family_date)` | **No new migration** — already in `0003_training.sql`; mirrored in Drizzle schema | `m5-training-constraints.test.ts` pg_indexes check |
| One active definition per `(training_key, age_band)` | **Added** `0020_m5_training_constraints.sql` partial unique index `training_definitions_active_key_age_unique` | `m5-training-constraints.test.ts` insert violation `23505` |
| Table shape for Stroop/digit-span | **No new tables** — reuse `training_definitions.metric_schema`, events, numeric metrics | protocol + integration tests |

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | Migrations complete (applied `0020_m5_training_constraints`) |
| `pnpm test tests/unit/training` | Test Files 4 passed; Tests 15 passed |
| `pnpm test tests/integration/migrations` | Test Files 6 passed; Tests 33 passed |
| `pnpm test tests/integration/training` | Test Files 3 passed; Tests 17 passed |
| `pnpm test tests/integration/outbox tests/integration/audit` | Test Files 3 passed; Tests 23 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 7 warnings (pre-existing `@typescript-eslint/no-explicit-any` in unrelated files) |
| `pnpm format` | All matched files use Prettier code style |
| `git diff --check 9f0418814515d2165ebba90b1e98da274ec4eacd..HEAD` | no conflicts (pre-commit) |

## Unresolved / blockers

- none for P1 authorized scope
- P2/P3 intentionally not started (trends, UI, E2E, AC-M5-05～10)
