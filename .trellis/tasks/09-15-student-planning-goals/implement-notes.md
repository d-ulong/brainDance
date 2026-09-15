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
- Service: horizon on create/update/list; `recordGoalGiftRedemption` with assignment FOR UPDATE, goalCommands idempotency, responsible-parent + succeeded + non-empty actualGift checks, audit/outbox `goal.gift_redeemed`.
- Route `POST /api/goals/[assignmentId]/gift-redemption`; m2-api DTO/client wired; parent/student goal UI horizon grouping + redemption action.

### R3-R4 / AC parent nav + answer media
- Parent plans: `?scope=self` hides StudentManagementTabs, backHref `/account`.
- PushDeliveryThread renders answer.media through MediaPreviewList.

### R5-R6 / AC plan description + generated dates
- Entry description max 500 in plan-definition.ts; forms round-trip description.
- Schedule item DTO exposes frozen snapshot entry description.
- Plan library list projects generatedDatesByStudent from distinct schedule_items.family_date facts.
- Pure helpers compactFamilyDates / formatCompactDateSegments / truncateSegments + CompactGeneratedDates expand UI.

## Verification

Vitest global setup used isolated DB `braindance_student_planning_goals_test_20260915` (never default `braindance`). Goal gift suite additionally opens a fresh DB via `openIsolatedM2Database()`.

```text
pnpm test -- tests/unit/schedule/compact-family-dates.test.ts tests/unit/schedule/plan-definition.test.ts
-> 2 files / 46 tests passed

pnpm test -- tests/integration/goals/goal-horizon-and-gift-redemption.test.ts tests/integration/settlement/goals-and-manual-penalties.test.ts
-> 4 tests passed

pnpm test -- tests/integration/goals/goal-horizon-and-gift-redemption.test.ts tests/integration/schedule/plan-library.test.ts
-> 13 tests passed (includes description snapshot + generatedDatesByStudent)
```

## Known limitations

- No dedicated Playwright E2E in this commit for workbench tabs absence / parent self tabs / answer media; covered by page wiring + shared MediaPreviewList capability path.
- Concurrent gift-redemption race is enforced by unique assignment_id; focused test covers idempotent replay + payload conflict rather than a multi-connection stress race.
