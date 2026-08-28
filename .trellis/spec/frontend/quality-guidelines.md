# Quality Guidelines

> Code quality, testing, accessibility, and E2E expectations for frontend work in BrainDance.

---

## When This Applies

Before submitting UI changes: run lint/typecheck/build and relevant E2E specs.

---

## Current Project Pattern

### Toolchain

| Gate | Command | Notes |
|------|---------|-------|
| TypeScript | `pnpm typecheck` | Strict mode, `@/*` imports |
| ESLint | `pnpm lint` | `eslint.config.mjs` — Next core-web-vitals + TypeScript |
| Prettier | `pnpm format` | Check only; `pnpm format:write` to fix |
| Next build | `pnpm build` | Catches App Router and client/server boundary issues |
| E2E | `pnpm test:e2e` | Playwright via `scripts/run-e2e.mts` |

### E2E setup

Config: `playwright.config.ts`

- Test dir: `tests/e2e/`
- **Two projects**: `desktop-chromium` and `mobile-360` (360×800 viewport)
- Single worker, not fully parallel — avoids shared server/DB races
- Default run **ignores** `m1-evidence-capture.spec.ts` (screenshot evidence script)
- Starts Next production server on port 3002 unless `E2E_SUPERVISED=true`
- Fixture users: `tests/e2e/.fixture.json` loaded by `loadE2eFixture()` in `tests/e2e/ui-helpers.ts`

Key specs:

| Spec | Coverage |
|------|----------|
| `tests/e2e/home.spec.ts` | Home navigation |
| `tests/e2e/m1-browser-flow.spec.ts` | M1 browser flows |
| `tests/e2e/training-flow.spec.ts` | Training interaction |
| `tests/e2e/m2-schedule-points-flow.spec.ts` | Plan, schedule, points, idempotent complete, horizontal scroll guard |

Helpers in `tests/e2e/ui-helpers.ts`:

- `loginViaUi`, `logoutViaUi`, `fillField`
- Uses `data-testid` and `getByRole` for stable selectors

### Testing requirements for UI changes

1. **Add or extend `data-testid`** on new interactive elements when E2E needs to target them — follow existing names (`login-identifier`, `complete-button-${id}`).
2. **Run both viewport projects** when changing layout — mobile 360px is an architecture acceptance width (`docs/architecture.md` §6).
3. **Auth flows** — use fixture credentials; do not hardcode secrets in spec files.
4. **API-dependent UI** — E2E may combine `page` and `request` fixtures (see `m2-schedule-points-flow.spec.ts`).

Unit/integration tests do not render React components today (no `@testing-library/react` in `package.json`). Frontend correctness is validated through typecheck, build, lint, and Playwright E2E.

### Accessibility expectations

Aligned with `docs/architecture.md` §6:

- Mobile-first layout; touch-friendly controls (`min-h-11` on buttons/inputs in `page-shell.tsx`).
- Training flows must support keyboard activation where applicable (training E2E covers reaction flow).
- Visible focus and screen-reader-friendly status text — schedule status rendered as Chinese text, not color alone.
- Root document language: `lang="zh-CN"` in `src/app/layout.tsx`.

E2E accessibility patterns:

```typescript
await page.getByRole("button", { name: "登录" });
await page.getByTestId("login-identifier");
```

### Responsive / layout checks

`tests/e2e/m2-schedule-points-flow.spec.ts`:

```typescript
async function assertNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}
```

Run on mobile project when changing horizontal layout or wide content.

### Required patterns

- `"use client"` on pages that use hooks or browser APIs.
- User-visible errors via `<Alert tone="error">` with message from `ApiError` when possible.
- Loading states via `<LoadingState />` or disabled buttons with in-progress label (`登录中…`).
- Credentials: `apiFetch` uses `credentials: "same-origin"` for session cookies.

### Forbidden patterns

- **Skipping E2E for user-visible M2 flows** — schedule/points/plan changes should extend `m2-schedule-points-flow.spec.ts` or add a focused spec.
- **Hard-coded API URLs** — use relative paths (`/api/...`) through `lib/client` helpers.
- **Removing `data-testid` used by E2E** without updating specs.
- **`eslint-disable` without strong reason** — not used in current UI files.

### Full verification bundle

```bash
pnpm verify:m1-remediation
```

Frontend-focused minimum:

```bash
pnpm typecheck && pnpm lint && pnpm format && pnpm build && pnpm test:e2e
```

---

## Code Review Checklist

- [ ] Page uses `PageShell` and existing UI primitives where applicable
- [ ] New API calls added to `src/lib/client/` with typed responses
- [ ] Loading and error states handled
- [ ] `data-testid` added for new E2E-critical controls
- [ ] Works at 360px width (no horizontal scroll)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` pass
- [ ] Relevant E2E spec updated or run clean

---

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```
