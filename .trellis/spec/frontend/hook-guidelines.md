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

### Custom hooks — not present today

The repository has no shared custom hooks and no extraction threshold or return-shape convention to follow. Stateful logic stays inline in the page or component file using the React built-ins listed above.

If a future task introduces the first shared hook, that task must explicitly define its file location, naming, return shape, and tests. This bootstrap document does not pre-approve a `src/hooks/` layout or a fixed API contract.

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
pnpm test:e2e
```

E2E coverage for inline hook patterns: `tests/e2e/training-flow.spec.ts`.
