# State Management

> How UI state is held and updated in BrainDance.

---

## When This Applies

Use when deciding where to store data in pages and components.

---

## Current Project Pattern

### No global client state library

The project does **not** use Redux, Zustand, Jotai, Context-based stores, or React Query. UI state is **component-local** using React primitives — primarily `useState` for render-driving values and `useRef` for mutable or timing state that should not trigger re-renders.

Server/session state is loaded on demand through fetch helpers, not synchronized through a global cache.

### State categories in practice

| Category | Mechanism | Example |
|----------|-----------|---------|
| Form input | `useState` per field | `identifier`, `password` in `src/app/login/page.tsx` |
| Request status | `useState` flags | `loading`, `error`, `completingId` in `src/app/student/schedule/page.tsx` |
| Fetched lists/objects | `useState` + `useEffect` load | `items`, `students`, `balance` |
| Session gate | `fetchSession()` in `useEffect`, redirect via `useRouter` | `src/app/page.tsx`, schedule page |
| Refresh after mutation | Re-call load function or bump key | `loadSchedule(studentId)` after complete; `setCardRefreshKey(k => k+1)` to remount `PointsTodayCard` |
| Timing / imperative mutable state (no re-render) | `useRef` | `sequenceRef`, `stimulusShownAtRef`, `startedRef` in `src/app/student/training/reaction/page.tsx` — event sequence counter, stimulus timestamp, and one-shot start guard |

Use `useState` when the UI must re-render on change. Use `useRef` when values are read/written inside callbacks or timing logic without needing a render update.

### Session handling

`src/lib/client/api.ts` exports:

```typescript
export type SessionInfo = {
  userId: string;
  role: "admin" | "parent" | "student";
  contactVerified: boolean;
  status?: string;
  mustChangePassword?: boolean;
};

export async function fetchSession(): Promise<SessionInfo | null>
```

- Returns `null` on 401 (not logged in).
- Pages store session in local state (`useState<SessionInfo | null | undefined>`) with `undefined` meaning "still loading".
- No session context provider — each page that needs session fetches independently.

Home page role branching: `src/app/page.tsx` renders different nav and widgets based on `session.role`.

### Server / API state

M2 domain data types live in `src/lib/client/m2-api.ts` (`ScheduleItemDto`, `PointsBalanceDto`, etc.). Pages hold arrays/objects in state after `apiFetch` resolves.

Write operations use idempotency keys:

```typescript
// src/lib/client/m2-api.ts
headers: { "Idempotency-Key": newIdempotencyKey("complete-schedule") }
```

Errors surface as `ApiError` with `message` and optional `code` — caught and stored in local `error` state or shown via `<Alert tone="error">`.

### URL state

Dynamic route params (`[studentId]`, `[itemId]`) come from Next.js `useParams` or page props where used; there is no heavy use of query-string state libraries. Schedule list filters dates in code (`todayFamilyDate()`) rather than URL search params on student schedule page.

### Derived state

Computed inline during render (no `useMemo` in current pages):

- `canComplete = item.effectiveStatus === "pending"` — `src/app/student/schedule/page.tsx`
- Role-specific JSX branches on `session.role`

Label mapping helper: `scheduleStatusLabel()` in `src/lib/client/m2-api.ts`.

---

## Anti-Patterns

- **Introducing global store for session** — not used; would diverge from per-page `fetchSession` pattern unless multiple nested trees need the same data simultaneously.
- **Storing server data only in module-level variables** — breaks React rendering; always `useState` after fetch.
- **Optimistic updates** — not implemented today; wait for API success before updating lists (see `onCompleteItem` in schedule page).

---

## Verification

```bash
pnpm test:e2e
pnpm typecheck
```

E2E coverage for state patterns: `tests/e2e/m2-schedule-points-flow.spec.ts`, `tests/e2e/m1-browser-flow.spec.ts`.
