# M5 P3 Implementation Record

## Baseline and delivery

| Field | Value |
|-------|-------|
| execution_base | `76f95016ed41de01e5bd16219188295580483d48` |
| remediation_directive | `.trellis/tasks/08-30-m5-training-expansion-trends/research/p3-r06-scope-correction-directive.md` |
| branch | `feat/m5-training-expansion-trends` |
| stage | P3-R06 scope compliance correction (S1) — submitted for Codex final re-review; not GO, not M5 complete, not M6 |

## P3-R06 scope compliance correction (S1)

| ID | Action |
|----|--------|
| P3-R06-S1 | Removed unauthorized `@testing-library/react` and `happy-dom` from `package.json` / `pnpm-lock.yaml`; restored global `vitest.config.ts` (no `.test.tsx` include, no `esbuild.jsx`). Deleted `tests/unit/training/p3-r06-lifecycle.test.tsx`. Added `tests/e2e/p3-r06-lifecycle.spec.ts` — real Playwright lifecycle evidence for C1/C2 using existing `@playwright/test` stack. Fixed `digit-span/page.tsx` `react-hooks/exhaustive-deps` by adding `isInteractionAllowed` and `openResponsePhase` to pause/resume effect deps (no eslint-disable). C1/C2 production fixes from `6d2b7b2` retained unchanged. |

## P3-R06 evidence locations

| ID | Evidence |
|----|----------|
| P3-R06-C1 | `tests/e2e/p3-r06-lifecycle.spec.ts`: deferred stimulus while hidden; initial hidden sync on bind; recovery failure never reopens; abandoned blur never reopens. Production: `use-training-session-lifecycle.ts` (`setPausedSync`), `use-training-blur.ts` (initial hidden sync). |
| P3-R06-C2 | `tests/e2e/p3-r06-lifecycle.spec.ts`: digit-span timer survives hidden/pause race and resumes once into response. Production: `digit-span/page.tsx` timer gate + `resumeFromDisplayExpiryRef`. |
| P3-R06 helper | `tests/unit/training/pending-stimulus-gate.test.ts` (unchanged gate unit coverage) |

## Changed files (P3-R06-S1)

- `package.json`
- `pnpm-lock.yaml`
- `vitest.config.ts`
- `tests/unit/training/p3-r06-lifecycle.test.tsx` (deleted)
- `tests/e2e/p3-r06-lifecycle.spec.ts` (new)
- `src/app/student/training/digit-span/page.tsx` (effect deps only)
- `.trellis/tasks/08-30-m5-training-expansion-trends/research/p3-implementation-record.md`

## Verification raw summary

| Command | Result |
|---------|--------|
| `pnpm exec playwright test tests/e2e/p3-r06-lifecycle.spec.ts` (via `pnpm test:e2e`) | exit 0; P3-R06 5/5 each viewport (10/10 total) |
| `pnpm test tests/unit/training/training-blur-coordinator.test.ts tests/unit/training/training-event-queue.test.ts` | exit 0; 10/10 passed |
| `pnpm test` | exit 1; Test Files 62 passed, 1 failed (63); Tests 480 passed, 3 failed (483). Failures: `m5-concurrency.test.ts` P1-R13/P1-R10 advisory-lock helper timeouts + P1-R32 cleanup aggregate (pre-existing P1 helper diagnostic debt, non-blocking) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 5 pre-existing warnings; no `digit-span/page.tsx` warning |
| `pnpm format` | All matched files use Prettier code style |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | exit 0; 46 passed (5.9m); desktop-chromium 23/23; mobile-360 23/23; M5 m5-training-flow 11/11 each viewport; P3-R06 p3-r06-lifecycle 5/5 each viewport |

## E2E matrix (M5-focused)

| Project | M5 + P3-R06 cases | Result |
|---------|-------------------|--------|
| desktop-chromium | m5-training-flow 11 + p3-r06-lifecycle 5 | 16/16 pass |
| mobile-360 | m5-training-flow 11 + p3-r06-lifecycle 5 | 16/16 pass |

## Non-blocking technical debt (unchanged)

- P1 race helper advisory-lock timeouts in `m5-concurrency.test.ts` (P1-R13/P1-R10/P1-R32)
- Stroop E2E reads `data-ink-color`; lifecycle hook responsibility; minor duplicate UI; trend tab race

## Unresolved / blockers

- none (P3-R06-S1 scope)
