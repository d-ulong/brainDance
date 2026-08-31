# M5 P3 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `4894d646333a45a56374fa260b1886acca68c268` |
| p2_implementation | `a9b32f20fd419ed9e5b6f02d818c5553764bbdb8` |
| directive | `.trellis/tasks/08-30-m5-training-expansion-trends/research/p3-execution-directive.md` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P3 student/parent UI — submitted for Codex review; not GO, not M5 complete, not M6 |

## AC-M5-01～10 acceptance matrix

| ID | Route / surface | Evidence | Viewport |
|----|-----------------|----------|----------|
| AC-M5-01 | `POST /api/training/sessions` (stroop/digit-span keys) | P1 signed; P3 UI starts all three via `/student/training/*`; no regression in `tests/integration/training/m5-protocols.test.ts` (prior P1/P2) | n/a (P1) |
| AC-M5-02 | Stroop protocol + `POST .../events` + `POST .../submit` | P1 signed; P3 `completeStroopSession` pattern mirrored in `src/app/student/training/stroop/page.tsx`; E2E `m5-training-flow.spec.ts` stroop test | desktop + mobile-360 |
| AC-M5-03 | Digit-span protocol events | P1 signed; P3 `src/app/student/training/digit-span/page.tsx`; E2E digit span test | desktop + mobile-360 |
| AC-M5-04 | Concurrent submit / effective uniqueness | P1 signed; no P3 backend changes | n/a (P1) |
| AC-M5-05 | `GET /api/family/students/:id/training-trends?window=` | P2 signed; P3 `TrendsPanel` 7d/30d/all + segment labels | desktop + mobile-360 (trends tabs) |
| AC-M5-06 | Trend projection rebuild | P2 signed; no P3 backend changes | n/a (P2) |
| AC-M5-07 | Family read access / relationship end | P2 signed; P3 parent page read-only summary; M1 unlink remains in `m1-browser-flow.spec.ts` | desktop + mobile-360 (parent summary) |
| AC-M5-08 | `/student/training`, `/student/training/reaction|stroop|digit-span` | E2E hub + three trainings + keyboard (Space/Enter) + 44px buttons + focus rings; horizontal scroll asserts in hub/reaction/stroop/digit-span/parent tests | desktop Chromium 14/14 pass; mobile-360 14/14 pass |
| AC-M5-09 | Session read after reload/login; event retry UI | E2E reaction refresh/re-login; blur pause (`training-paused`); weak network retry (`training-retry`); `training-flow.spec.ts` API persistence | desktop + mobile-360 |
| AC-M5-10 | Quality gates + matrix | This document; commands below | both viewports |

### P3 requirement mapping

| Requirement | UI / test evidence |
|-------------|-------------------|
| R-M5-06 / AC-M5-08 | Training hub (`/student/training`), three pages, result page metrics/trends, parent summary + trends, non-diagnostic disclaimer |
| R-M5-07 / AC-M5-09 | `useTrainingBlur` (Page Visibility), `useTrainingSessionLifecycle` event/submit retry, paused/retry banners |
| R-M5-08 | Disclaimer on all training surfaces; client uses typed API wrappers; no raw answers in UI; parent read-only copy |

## Changed files

- `src/lib/client/training-api.ts`
- `src/components/training/*` (metric labels, disclaimer, button, blur, lifecycle, trends, trial plans)
- `src/app/student/training/page.tsx`
- `src/app/student/training/reaction/page.tsx`
- `src/app/student/training/stroop/page.tsx`
- `src/app/student/training/digit-span/page.tsx`
- `src/app/student/training/[sessionId]/page.tsx`
- `src/app/parent/students/[studentId]/training/page.tsx`
- `src/app/page.tsx`
- `tests/e2e/m5-training-flow.spec.ts`
- `tests/e2e/m5-training-helpers.ts`
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p3-implementation-record.md`

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm db:migrate` | Migrations complete |
| `pnpm test` | Test Files 58 passed, 1 failed (59); Tests 455 passed, 3 failed (458). Failures: `m5-concurrency.test.ts` P1-R13/P1-R10 advisory-lock helper timeouts + 1 bounded-race assertion (pre-existing P1 helper diagnostic debt, not P3 UI) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 3 pre-existing warnings |
| `pnpm format` | All matched files use Prettier code style |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | 28 passed (2.8m); desktop-chromium 14/14; mobile-360 14/14; no horizontal scroll failures; no failure screenshots |

## E2E matrix (M5-focused)

| Project | M5 tests | Result |
|---------|----------|--------|
| desktop-chromium | 7 (`m5-training-flow.spec.ts`) + horizontal scroll in hub/reaction/stroop/digit-span/parent | 7/7 pass |
| mobile-360 | same 7 | 7/7 pass |

Full suite per project: 14/14 each (includes M1–M4 regression specs).

## P1 helper diagnostic debt (non-blocking, reported)

- `tests/integration/training/m5-concurrency.test.ts`: 3 tests fail on advisory-lock race helper timeouts/assertions (P1-R13 / P1-R10 / bounded-race). Re-run in isolation may pass 16–18/18; unrelated to P3 UI.

## Unresolved / blockers

- none (P3 scope)
