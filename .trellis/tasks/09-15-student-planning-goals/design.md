# Technical Design — Student planning and goals experience

## Boundaries and authoritative data

| Concern | Authority and change |
| --- | --- |
| Goal horizon | Add `horizon` (`short` / `medium` / `long`) to `goal_definitions`; it remains editable core configuration under the existing revision and terminal-freeze rules. |
| Gift redemption | Add immutable `goal_gift_redemptions`: one row per `goal_assignment`, storing the success assignment, the responsible parent recorder, and `redeemed_at`. It is a fact rather than a mutable assignment column, preserving terminal-fact immutability. |
| Plan item description | Extend the existing typed JSON plan entry with optional `description`, maximum 500 characters. The entry is copied into activation definitions and schedule-item snapshots/rules by existing generation flows. |
| Generated dates | Derive distinct `schedule_items.family_date` values for every plan library activation, grouped by library and subject; no separate date projection or mutable history is introduced. |
| Answer media | Continue to use `MediaPreviewList`, the capability issuance route, and protected byte retrieval. The missing parent answer-media render is fixed at the shared delivery-thread consumer. |

## Data and API flow

```text
goal form → route validation → goal service/transaction → goal definition or immutable redemption fact
  → goal DTO → parent/student grouped goal cards

plan form → plan definition parser → plan library/activation snapshot → schedule item snapshot
  → plan-library list projection (generated dates) and schedule DTO (entry description) → cards/calendar

parent answer DTO → PushDeliveryThread → MediaPreviewList → capability → protected image bytes
```

### Goal contracts

- Create/update routes accept the required `horizon` enum; `GoalDto` returns it.
- Add a dedicated idempotent redemption command route. It accepts a valid, non-future ISO timestamp and calls `recordGoalGiftRedemption`.
- Only the assignment's responsible parent can record it; the assignment must be `succeeded` and have a non-empty `actualGift`. A unique assignment constraint and transactional lock make the first successful record immutable and prevent duplicate facts.
- The transaction inserts the redemption fact, idempotency result, audit event and outbox event together. `listGoals` left-joins/projects the redemption timestamp.
- Existing goal definitions receive a compatible migration default of `medium` to avoid ambiguity in historical data. Existing completed gifts have no redemption fact and display as unredeemed.

### Plan and schedule contracts

- `PlanEntry.description` stays optional for backward compatibility; the parser limits new and edited values to 500 characters. Parent and student draft mappers round-trip it.
- The calendar/list schedule DTO exposes the snapshot entry description rather than consulting the currently editable library, so historical generated tasks remain explanatory and stable.
- The plan-library list query produces `generatedDatesByStudent` from authoritative schedule items associated with each activation/library. Dates are sorted, distinct, and include any generated historical item regardless of later status.
- One shared pure formatter compacts sorted family dates into continuous inclusive ranges and emits expandable date chips. Parent cards render dates per bound student; student cards render the self binding.

### Student workspace and navigation

- Replace the student-plan page's `workspaceView` query state and overview card with a single page of collapsible sections. The summary queries balance plus today schedule once and keeps task details accessible by click/keyboard; completed task rows use the semantic green success style.
- Keep `/student/schedule` as a compatibility redirect to the new anchored/appropriate unified workspace URL.
- Separate parent personal pages from `StudentManagementTabs`: the self route renders no student-management navigation and generic student-management routes retain only student-scoped links. Account links remain parent-specific.

### Answer image presentation

- `PushDeliveryThread` renders each answer's `media` via `MediaPreviewList` with that thread's `studentId`, preserving capability binding to the student and image reference. Error behavior remains the shared component's unavailable indicator.

## Migration and rollout

1. Expand schema with nullable/backfilled-compatible goal horizon and the redemption fact table, constraints, indexes and foreign keys.
2. Deploy service/route/DTO compatibility changes and UI. Existing plans omit entry descriptions; existing goals display `medium`; existing gifts remain unredeemed.
3. No contract/removal phase is needed for this request.

Rollback is additive: revert callers/UI first; the new fields/table are harmless and preserve facts already recorded.

## Risks and controls

- A redemption timestamp is a business fact: a unique DB constraint and one transactional command avoid duplicate timestamps or an editable terminal field.
- Generated dates must not infer recurrence, because skipped/cancelled/generated history matters; query existing schedule facts instead.
- The parent-media repair must not build raw object URLs or bypass capabilities; reuse the tested protected preview component.
