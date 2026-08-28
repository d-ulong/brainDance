# Directory Structure

> How frontend code is organized in BrainDance.

---

## When This Applies

Use this layout when adding pages, shared UI, or client-side API helpers.

---

## Current Project Pattern

### App Router pages — `src/app/`

Pages follow Next.js App Router file conventions:

| Pattern | Path example | Role |
|---------|--------------|------|
| Root layout (Server Component) | `src/app/layout.tsx` | HTML shell, metadata, global CSS import |
| Route page | `src/app/login/page.tsx` | Screen-level UI |
| Role-based areas | `src/app/parent/**`, `src/app/student/**`, `src/app/admin/**` | Parent, student, admin flows |
| Global styles | `src/app/globals.css` | Tailwind entry |

**Client vs server boundary today:**

- `src/app/layout.tsx` is a **Server Component** (no `"use client"`).
- **All route `page.tsx` files are Client Components** — every page under `src/app/` that renders UI uses `"use client"` at the top.
- There is no `loading.tsx`, `error.tsx`, or React Server Component data fetching on pages yet; pages fetch via client-side `fetch` in `useEffect`.

Reference pages:

- Home with role branching: `src/app/page.tsx`
- Form page: `src/app/login/page.tsx`
- M2 feature page: `src/app/student/schedule/page.tsx`
- Parent plan management: `src/app/parent/students/[studentId]/plan/page.tsx`

### Shared components — `src/components/`

| Folder | Purpose | Examples |
|--------|---------|----------|
| `src/components/ui/` | Reusable layout and form primitives | `page-shell.tsx` — `PageShell`, `Alert`, `PrimaryButton`, `TextInput`, `Field` |
| `src/components/m2/` | Milestone-specific composed widgets | `points-today-card.tsx` |

There is no `src/components/` barrel export; import by file path:

```typescript
import { PageShell, Alert } from "@/components/ui/page-shell";
import { PointsTodayCard } from "@/components/m2/points-today-card";
```

### Client API layer — `src/lib/client/`

| File | Purpose |
|------|---------|
| `src/lib/client/api.ts` | `apiFetch`, `ApiError`, `fetchSession`, `newIdempotencyKey` |
| `src/lib/client/m2-api.ts` | M2 DTO types and domain-specific fetch wrappers |

Pages and components call these helpers; they do not call `fetch` with raw URLs scattered across the codebase.

### What is not in the frontend tree

- **No `src/hooks/` directory** — no project custom hooks yet (see hook guidelines).
- **No global state store** — no Redux, Zustand, or React Query (see state management).
- **API route handlers** live under `src/app/api/` (documented in backend guidelines).

---

## Directory Layout

```text
src/
├── app/
│   ├── layout.tsx              # Server Component root
│   ├── globals.css
│   ├── page.tsx                # Home — client
│   ├── login/page.tsx
│   ├── parent/...
│   ├── student/...
│   └── admin/...
├── components/
│   ├── ui/page-shell.tsx
│   └── m2/points-today-card.tsx
└── lib/client/
    ├── api.ts
    └── m2-api.ts
```

---

## Naming Conventions

| Kind | Convention | Example |
|------|------------|---------|
| Page file | `page.tsx` in route folder | `src/app/student/schedule/page.tsx` |
| Default export | Named `*Page` function matching route | `StudentSchedulePage`, `LoginPage` |
| UI components | PascalCase, one primary export per file | `PageShell`, `PointsTodayCard` |
| Client API functions | camelCase verb phrases | `fetchScheduleItems`, `completeScheduleItem` |
| Test IDs | kebab-case on `data-testid` | `login-identifier`, `complete-button-${item.id}` |

---

## Anti-Patterns

- **Server Component pages with hooks** — current pages are all client-side; do not add `useState` to a file without `"use client"`.
- **Scattering fetch calls** — add new endpoints to `src/lib/client/api.ts` or `m2-api.ts`, not inline in many pages.
- **Feature components in `ui/`** — keep `ui/` generic; put milestone/domain widgets in `components/m2/` or a new feature folder.

---

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

E2E coverage for page layout: `tests/e2e/home.spec.ts`. Reference E2E navigation helpers: `tests/e2e/ui-helpers.ts`.
