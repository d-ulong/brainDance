# M5 P3 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `ca28f28801a2db8c5861aca0c1bfcbf30846de13` |
| remediation_directive | `.trellis/tasks/08-30-m5-training-expansion-trends/research/p3-consolidated-remediation-directive.md` |
| candidate_implementation | `a5d021eb6b057bb9cfb93a11a560060c9b2cc138` (pre-remediation) |
| branch | `feat/m5-training-expansion-trends` |
| stage | P3 consolidated remediation — submitted for Codex review; not GO, not M5 complete, not M6 |

## AC-M5-01～10 acceptance matrix

| ID | Route / surface | Evidence | Viewport |
|----|-----------------|----------|----------|
| AC-M5-01 | `POST /api/training/sessions` | P1 signed; P3 UI starts all three via `/student/training/*`; no regression in prior P1/P2 integration tests | n/a (P1) |
| AC-M5-02 | Stroop protocol + events + submit | P3 stroop page uses focused-option keyboard/pointer; E2E `stroop keyboard selects focused option` + `stroop training completes with color buttons` | desktop + mobile-360 |
| AC-M5-03 | Digit-span protocol events | P3 digit-span hides stimulus before response; E2E `digit span hides stimulus before response and completes from known input` uses `responseDigitsForAttempt` (no DOM answer read) | desktop + mobile-360 |
| AC-M5-04 | Concurrent submit / effective uniqueness | P1 signed; no P3 backend changes | n/a (P1) |
| AC-M5-05 | `GET /api/family/students/:id/training-trends?window=` | P2 signed; P3 trends tabs in student/parent E2E | desktop + mobile-360 |
| AC-M5-06 | Trend projection rebuild | P2 signed; no P3 backend changes | n/a (P2) |
| AC-M5-07 | Family read access / relationship end | E2E `parent unlink immediately revokes access while other parent retains read` (parent2 unlinked; fixture parent retains read; API 403/trends 403) | desktop + mobile-360 |
| AC-M5-08 | Three training routes + dual input | Hub + three trainings; reaction keyboard/pointer; stroop focused keyboard; digit-span touch; horizontal scroll asserts | desktop + mobile-360 |
| AC-M5-09 | Session persistence; blur; weak network | E2E: short blur complete once; >30s abandoned; blur recovery failure; weak network event+submit retry with final `completed` + ordered sequences + `eventCount=10` | desktop + mobile-360 |
| AC-M5-10 | Quality gates + matrix | This document; commands below | both viewports |

### P3 remediation mapping (P3-R01～R04)

| ID | Evidence |
|----|----------|
| P3-R01 | Stroop: removed global inkColor shortcut; option click/keyboard via `inputMethodFromClick`; E2E wrong/correct keyboard paths. Reaction: `useKeyboardAction` → `keyboard`, click → `pointer`. |
| P3-R02 | Digit-span: stimulus phase with `digit-stimulus`, hidden before `data-ready=true` response; removed `digit-expected` sr-only; E2E uses plan formula not page digits. |
| P3-R03 | `training-event-queue.ts` serializes append; response opens only after stimulus append success; blur unpause after successful `session.blur`; `terminated` on abandoned/recovery failure; unit `training-event-queue.test.ts`. |
| P3-R04 | E2E matrix expanded to 11 cases × 2 viewports (22 total M5 runs); weak network verifies failed posts + final session detail; parent unlink uses parent2 teardown preserving fixture parent. |

## Changed files

- `src/components/training/training-event-queue.ts` (new)
- `src/components/training/use-training-session-lifecycle.ts`
- `src/components/training/use-training-blur.ts`
- `src/components/training/digit-span-plan.ts`
- `src/app/student/training/stroop/page.tsx`
- `src/app/student/training/reaction/page.tsx`
- `src/app/student/training/digit-span/page.tsx`
- `tests/unit/training/training-event-queue.test.ts` (new)
- `tests/e2e/m5-training-flow.spec.ts`
- `tests/e2e/m5-training-helpers.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p3-implementation-record.md`

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | Migrations complete |
| `pnpm test` | Test Files 59 passed, 1 failed (60); Tests 460 passed, 2 failed (462). Failures: `m5-concurrency.test.ts` P1-R13/P1-R10 advisory-lock helper timeouts (pre-existing P1 helper diagnostic debt, non-blocking per P3 directive) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 pre-existing warnings |
| `pnpm format` | All matched files use Prettier code style |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | 36 passed (5.1m); desktop-chromium 18/18; mobile-360 18/18; M5 11/11 each viewport |

## E2E matrix (M5-focused)

| Project | M5 cases (`m5-training-flow.spec.ts`) | Result |
|---------|----------------------------------------|--------|
| desktop-chromium | 11 | 11/11 pass |
| mobile-360 | 11 | 11/11 pass |

Full suite per project: 18/18 each (includes M1–M4 regression specs + 11 M5 cases).

## P1 helper diagnostic debt (non-blocking, reported)

- `tests/integration/training/m5-concurrency.test.ts`: 2 tests fail on advisory-lock race helper timeouts (P1-R13 / P1-R10). Unrelated to P3 UI; serial re-run may pass.

## Unresolved / blockers

- none (P3 remediation scope)
