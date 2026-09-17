# Implementation notes - 09-15-student-planning-goals

## Summary

Delivered goal horizon + immutable gift redemption, plan entry description (max 500) with schedule snapshot + generated-date compaction, student collapsible workbench, parent self-scope plans nav fix, and push answer media preview.

## What changed

### R1 / AC student workspace
- Replaced student plans tabs + PointsTodayCard overview with one page of collapsible sections: summary (balance + today/completed tasks), schedule, plans, goals.
- Completed tasks use emerald styling and expose detail via click/hover.
- `/student/schedule` redirects to `/student/plans?view=schedule`.

### R2 / AC goal horizon + gift redemption
- Migration `0044_goal_horizon_and_gift_redemptions.sql`: additive `goal_definitions.horizon` + immutable `goal_gift_redemptions`.
- Service: horizon on create/update/list; `recordGoalGiftRedemption` with assignment `FOR UPDATE`, goalCommands idempotency, responsible-parent + succeeded + non-empty actualGift checks, audit/outbox `goal.gift_redeemed`.
- Route `POST /api/goals/[assignmentId]/gift-redemption`; m2-api DTO/client wired; parent/student goal UI horizon grouping + redemption action.

### R3-R4 / AC parent nav + answer media
- Parent plans: `?scope=self` hides StudentManagementTabs, backHref `/account`.
- PushDeliveryThread renders answer.media through MediaPreviewList.

### R5-R6 / AC plan description + generated dates
- Entry description max 500 in plan-definition.ts; forms round-trip description.
- Schedule item DTO exposes frozen snapshot entry description.
- Plan library list projects generatedDatesByStudent from distinct schedule_items.family_date facts.
- Pure helpers compactFamilyDates / formatCompactDateSegments / truncateSegments + CompactGeneratedDates expand UI.

## Remediation (this commit)

- Applied additive `0044` on confirmed local `localhost/braindance` after verifying missing `horizon` / `goal_gift_redemptions`.
- Fixed `listStudentPlanLibrary` generated-id mapping to `row.library.id` (typecheck `never`).
- Parent goals/plans: `selfOnly` derived from `useSearchParams()` (Suspense-wrapped), not lagged effect state.
- `activatePlanLibrary` shifts the 15-day window to `definition.startDate` when later than the default/from date; returns `generatedFrom`/`generatedThrough`/`matchedOccurrences` and actual inserted `itemsCreated`; UI messages cover count, range, empty recurrence, and idempotent replay.
- Shared Modal: sticky title/close bar; body scrolls independently.
- Student workbench load uses `Promise.allSettled` so goals/plan-library failures do not blank the whole page.
- Added route/integration/E2E coverage for the above.

## Verification

Isolated `DATABASE_URL=postgresql://braindance:braindance@localhost:5432/braindance_test` (never default `braindance`).

```text
pnpm typecheck
pnpm test -- tests/integration/schedule/plan-library.test.ts tests/integration/api/goals-and-plan-library-routes.test.ts tests/integration/goals/goal-horizon-and-gift-redemption.test.ts tests/unit/schedule/compact-family-dates.test.ts
```
