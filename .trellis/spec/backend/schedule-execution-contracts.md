# Schedule Execution Contracts

> Cross-layer contract for schedule status, direct completion, and future-item clearing.

## 1. Scope / Trigger

Use this contract whenever a schedule execution fact, effective status, completion payload, clearing rule, or schedule DTO changes. A write is not complete until the authoritative fact survives the query service, DTO, client label, and visible component.

## 2. Signatures

- `POST /api/schedule-items/:itemId/start` records authoritative `plan_item_rules.started_at`.
- `POST /api/schedule-items/:itemId/complete` accepts `{ startedAt?, completedAt?, durationMinutes? }`.
- `DELETE /api/family/students/:studentId/schedule-items` accepts `{ from, through }` plus `Idempotency-Key`.
- `ScheduleItemDto.effectiveStatus` is `pending | in_progress | completed | skipped | expired | cancelled` and includes `startedAt: string | null`.

## 3. Contracts

- `completedAt` and `durationMinutes` are mutually exclusive. If a task was already started, the stored `startedAt` is authoritative.
- Direct completion may supply an execution interval without a prior start click. The service stores `sourceKind=manual`, `submittedBy`, start/end/duration, and settles against the rule frozen for the item.
- Effective `in_progress` is derived from a non-null start fact while the item remains pending; it is never inferred in the browser.
- Clearing is a soft transition to `cancelled`. Parents may clear an actively related student's eligible items; students may clear only eligible items whose `owner_id` is themselves.
- Regenerating a plan-library range revives matching `cancelled` rows back to `pending` (overwrite) instead of leaving cancelled rows visible beside new work. Calendar queries omit `cancelled` items by default.
- Parents may start/complete their own personal schedule items (`actorId === studentId`) without a family relationship check; acting on a linked student still requires an active relationship.
- Completed schedule DTOs expose `pointsEarned`, `pointsRuleLabel`, and `maximumPoints` so the calendar can show score and matched rule on click/hover.
- Period summary (`今日积分净变动` / `日程得分 / 全部完成最高`) must mark loading immediately on start/complete and refetch from authoritative ledger/query as soon as the write succeeds; the completion dialog may close without waiting for the refetch to finish, but the summary area must show the updating state until fresh numbers arrive.
- Clearing range starts today, ends no later than today + 89 days, and spans at most 90 calendar days. Started, completed, skipped, expired, suppressed, or already cancelled items are preserved.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| End and duration both supplied | `VALIDATION_ERROR`, HTTP 400 |
| Start/end invalid, reversed, or future | `VALIDATION_ERROR`, HTTP 400 |
| Duration mode pushes end past now | `VALIDATION_ERROR` with copy about start+duration, not a blank end-time field |
| Ordinary completion after the next-day 18:00 cutoff | completion-window error; no positive settlement |
| Student clears a parent-owned item | item remains unchanged |
| Parent lacks an active relationship | forbidden |
| Range starts before today, exceeds today + 89, or spans over 90 days | `VALIDATION_ERROR`, HTTP 400 |
| Same idempotency key and payload repeats | return prior cleared count without another transition |
| Same idempotency key with different payload | conflict |

## 5. Good / Base / Bad Cases

- Good: start an item, refetch it as `in_progress`, complete it using stored start plus an end time, then observe one settlement.
- Base: directly complete a pending item with start plus duration; the service calculates the end and settlement.
- Bad: write `started_at` but keep the list DTO as `pending`, or filter clearing only by status while ignoring an existing start fact.

## 6. Tests Required

- Unit: `effectiveStatus({ status: "pending", startedAt })` returns `in_progress`.
- Integration: start, refetch, direct-complete, and assert manual provenance, interval fields, completion kind, and exactly one ledger entry.
- Integration: clear a mixed range and assert eligible student-owned/parent-authorized items cancel while started and completed items remain.
- Integration: assert authorization, 90-day boundaries, idempotent replay, and changed-payload conflict.
- UI-focused: assert `in_progress` has both a distinct label and a distinct non-color cue/style; direct completion exposes start + end/duration; errors render above the active feature modal.

## 7. Wrong vs Correct

### Wrong

```typescript
await recordStartedAt(itemId);
return scheduleItems.map(toDto); // query never reads startedAt
```

### Correct

```typescript
await recordStartedAt(itemId);
// Query joins the start fact, derives effectiveStatus, serializes startedAt,
// and the client uses the shared status label/style mapping.
return queryScheduleItems(studentId, range);
```

