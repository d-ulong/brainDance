# Hook Guidelines

> React hooks usage in BrainDance.

---

## When This Applies

Use when adding stateful logic to pages or components.

---

## Current Project Pattern

### No custom hooks directory

The repository has **no `src/hooks/` folder** and **no project-defined `use*` functions** under `src/`. A search for `export function use` / `export const use` in `src/` returns no custom hook modules.

Stateful logic lives **inline** in page and component files using React built-ins only.

### Hooks in use today

| Hook | Usage | Reference |
|------|-------|-----------|
| `useState` | Form fields, loading flags, error messages, fetched lists | `src/app/login/page.tsx`, `src/app/student/schedule/page.tsx` |
| `useEffect` | Session check on mount, initial data load | `src/app/page.tsx`, `src/components/m2/points-today-card.tsx` |
| `useCallback` | Stable fetch functions passed to effects | `src/app/student/schedule/page.tsx` (`loadSchedule`), `points-today-card.tsx` (`load`) |
| `useRouter` | Redirect when unauthenticated or wrong role | `src/app/login/page.tsx`, `src/app/student/schedule/page.tsx` |

Example from `src/app/student/schedule/page.tsx`:

```typescript
const loadSchedule = useCallback(async (sid: string) => {
  setError(null);
  const today = todayFamilyDate();
  const result = await fetchScheduleItems(sid, today, today);
  setItems(result.items.filter((item) => item.familyDate === today));
}, []);

useEffect(() => {
  void (async () => {
    const session = await fetchSession();
    if (!session || session.role !== "student") {
      router.replace("/login");
      return;
    }
    // ...
  })();
}, [loadSchedule, router]);
```

### Data fetching

There is **no React Query, SWR, or similar**. Async work is:

1. Triggered in `useEffect` or event handlers.
2. Wrapped in `try/catch` with `ApiError` checks.
3. Stored in local `useState`.

Client fetch helpers: `src/lib/client/api.ts`, `src/lib/client/m2-api.ts`.

### When to extract a custom hook

Not required by current codebase size. If extraction becomes warranted:

- Place under `src/hooks/use-<name>.ts` (directory does not exist yet — create when first hook is shared by 2+ pages).
- Name with `use` prefix per React rules.
- Keep hooks thin: call existing `lib/client` helpers, return `{ data, loading, error, refetch }` shape consistent with `PointsTodayCard` / page patterns.

Until then, **copy the inline `useEffect` + `useState` + `useCallback` pattern** from existing pages rather than introducing a new abstraction.

---

## Anti-Patterns

- **Adding React Query/SWR without team decision** — not in dependencies (`package.json`); pages assume manual fetch.
- **Custom hook per page for one-off logic** — YAGNI; inline in the page file matches current style.
- **Hooks in Server Components** — only Client Components (`"use client"`) may use hooks.

---

## Verification

```bash
# Confirm no custom hook modules yet (expected empty)
rg -n "^export (function|const) use[A-Z]" src/

pnpm typecheck
pnpm test:e2e tests/e2e/training-flow.spec.ts
```
