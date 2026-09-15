# Cursor implementation directive

**Active task:** `.trellis/tasks/09-15-student-planning-goals`  
**Branch:** `main`  
**Complete baseline SHA:** `e6507c05825b7cda647b53924a9dffef0082af76`

Implement only the requirements and acceptance criteria in this task's `prd.md`, following `design.md` and `implement.md`. Read all three before modifying code. This is one focused implementation phase; do not begin another task or modify Trellis planning/signoff/status files.

## Scope

1. Add hand-selected goal horizon (`short`, `medium`, `long`) to create/edit/read paths and group goal UI accordingly.
2. Add a one-time immutable gift-redemption fact for a succeeded student goal with an actual gift. Only the responsible parent may record a valid non-future precise timestamp. Persist it with idempotency, audit and outbox in the same transaction; return it in goal DTOs and render the redeemed/unredeemed states.
3. Extend plan entry definitions with an optional description limited to 500 characters. Round-trip it in parent/student plan forms and cards, and expose the frozen snapshot description to generated schedule UI.
4. Project actual distinct generated schedule dates per plan and subject. Use a shared pure compaction helper: contiguous dates become an inclusive range, non-contiguous groups remain separate, singletons remain individual dates; initial display truncates with an accessible expand control; no dates reads as not generated.
5. Replace the student plan page's standalone overview and plan/schedule/goal tab state with the specified one-page collapsible workbench. It must show balance, today tasks, completed tasks and status details, preserve calendar and task actions, and use visible text plus green styling for completion.
6. Keep parent self goal/plan routes out of student-management secondary navigation.
7. Render parent-visible answer media in `PushDeliveryThread` by reusing `MediaPreviewList`; do not bypass capability issuance or protected byte reads.

## Authority, facts and transactions

- `goal_definitions` owns editable horizon configuration and existing optimistic revision behavior. Backfill existing rows with compatible `medium` via an additive migration.
- A new `goal_gift_redemptions` fact table owns redemption; it must have a unique assignment constraint. Do not add an editable timestamp to `goal_assignments`, edit actual rewards, or alter ledger history.
- The redemption command locks the assignment, checks successful status, actual gift, responsibility and idempotency, then writes the fact, command result, audit and outbox in one transaction. Competing first writes must produce one fact only; replay returns the original result and changed-payload key conflicts.
- Generated dates derive from persisted schedule facts, not inferred recurrence. Plan entry description comes from the frozen snapshot in schedule displays, not the current editable library.
- Existing family relationship, answer-disclosure and media capability checks remain the access authority. Never expose a raw storage/public URL.

## Required failure and concurrency matrix

| Case | Expected result |
| --- | --- |
| Missing/invalid horizon or item description >500 | 400 validation error; no write |
| Existing plans/goals after migration | Read successfully; absent entry descriptions remain absent, historic horizons are `medium` |
| Non-responsible parent records redemption | forbidden; no fact/audit/outbox |
| Goal not succeeded or has no actual gift | state conflict; no fact |
| Future/invalid redemption timestamp | validation error; no fact |
| Two redemption requests / repeated same key | exactly one redemption fact, audit and outbox; same payload replays; changed payload conflicts |
| Parent loses relationship or media is undisclosed/revoked | image remains unavailable; no bypass |
| Schedule completed task | fresh read returns the server-owned completed state; UI exposes text and green visual cue |

## Tests and reporting

- Add focused unit/integration/E2E coverage specified by `implement.md`; do not use an implicit `.env.local` database for migrations, reset or truncate tests. Explicitly verify the isolated test target first.
- Preserve existing unrelated working-tree changes. Do not rebase, reset, force-push, deploy, alter secrets, or write direct cross-module tables.
- Run relevant focused tests and report each exact command/result, then make exactly one focused implementation commit containing code, migration, tests and an implementation note. Do not mark the task signed off or archived.
- Final handoff format: fixed commit SHA; changed files grouped by R/AC ID; validation results; known limits; and the exact statement `已交审核`.
