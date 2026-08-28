# Component Guidelines

> How UI components are built in BrainDance.

---

## When This Applies

Use when creating or modifying pages, shared UI primitives, or feature-specific widgets.

---

## Current Project Pattern

### Page as default export

Each route file exports a single default page component. Pages compose shared UI and handle loading/error state locally.

Example structure from `src/app/login/page.tsx`:

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Field, PageShell, PrimaryButton, TextInput } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession } from "@/lib/client/api";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // ...
}
```

### Shared shell — `PageShell`

`src/components/ui/page-shell.tsx` is the primary layout primitive:

- `PageShell` — title, optional subtitle, back link, optional logout button
- `Alert` — `tone`: `"info" | "error" | "success"`
- `PrimaryButton` — full-width, `min-h-11` touch target
- `TextInput`, `Field` — labeled form controls
- `LoadingState` — simple text loading indicator

Pages wrap content in `<PageShell>` for consistent mobile-first layout (`max-w-md`, centered column).

### Feature components

Domain widgets accept explicit props and manage their own fetch lifecycle.

Example from `src/components/m2/points-today-card.tsx`:

```typescript
type PointsTodayCardProps = {
  studentId: string;
  studentName?: string;
  planHref?: string;
};

export function PointsTodayCard({ studentId, studentName, planHref }: PointsTodayCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // loads balance + schedule via m2-api helpers
}
```

Parent passes `studentId`; card owns loading and error UI.

### Props conventions

- Use inline `type XxxProps = { ... }` above the component (not a separate props file).
- Optional props use `?`; required IDs (e.g. `studentId`) are required strings.
- Spread remaining native attributes where useful — `PrimaryButton` extends `React.ButtonHTMLAttributes<HTMLButtonElement>`; `Alert` spreads `React.HTMLAttributes<HTMLDivElement>`.
- Do not use `React.FC`; use named function components with explicit props types.

### Styling — Tailwind CSS v4

- Global entry: `src/app/globals.css` imported from root layout.
- Utility classes inline on elements; **no CSS modules, styled-components, or separate `.module.css` files**.
- Common patterns:
  - Cards: `rounded-xl border border-neutral-300 bg-white p-4`
  - Primary actions: `bg-neutral-900 text-white min-h-11`
  - Text: `text-sm text-neutral-600`, `break-words` for long content
- Body defaults in layout: `min-h-screen bg-neutral-50 text-neutral-900 antialiased`

### Composition

- Small local helpers allowed inside page files (e.g. `NavLink` in `src/app/page.tsx`).
- Prefer importing from `page-shell.tsx` over duplicating button/input markup.
- Use `next/link` for internal navigation; `useRouter` for redirects after auth checks.

### Accessibility patterns in use

From `src/components/ui/page-shell.tsx` and pages:

- `<label>` wraps field text + control via `Field` component.
- Buttons use native `<button type="button|submit">` with visible text (no icon-only actions).
- Form inputs set `autoComplete` where relevant (`login/page.tsx`: `username`, `current-password`).
- Touch targets: `min-h-11` on buttons and inputs.
- Language: root layout sets `<html lang="zh-CN">`; UI copy is Simplified Chinese.

E2E tests use roles and test IDs:

- `page.getByRole("button", { name: "登录" })` — `tests/e2e/ui-helpers.ts`
- `page.getByTestId("login-identifier")` — stable selectors on inputs and actions

Architecture target viewports (`docs/architecture.md` §6): 360px, 768px, 1024px, 1440px. E2E enforces no horizontal scroll at 360px in `tests/e2e/m2-schedule-points-flow.spec.ts` (`assertNoHorizontalScroll`).

---

## Anti-Patterns

- **Duplicating PageShell markup** — extend or reuse `page-shell.tsx` exports.
- **Icon-only buttons without accessible names** — not used today; keep visible text or `aria-label`.
- **Color as sole status indicator** — pair with text labels (schedule status shows Chinese text via `scheduleStatusLabel`).
- **Class name string concatenation without Tailwind** — stay on utility classes consistent with existing pages.

---

## Verification

```bash
pnpm lint
pnpm build
pnpm test:e2e tests/e2e/home.spec.ts
pnpm test:e2e tests/e2e/m2-schedule-points-flow.spec.ts
```

Visual/responsive evidence: `tests/e2e/m1-evidence-capture.spec.ts` (ignored in default Playwright run but documents capture approach).
