# Goal and Manual Points Contracts

## 1. Scope / Trigger

Use this contract whenever changing formal goals, goal rewards, manual penalties, period point summaries, or their API/UI consumers. These features cross authorization, immutable facts, balance projection, audit, and outbox boundaries.

## 2. Signatures

- `createGoals(db, { actorId, subjectIds?, content, dueDate, expectedPoints?, expectedGift?, notes?, idempotencyKey })`
- `approveGoal(db, { actorId, assignmentId, idempotencyKey })`
- `completeGoal(db, { actorId, assignmentId, idempotencyKey, now? })`
- `evaluateGoal(db, { actorId, assignmentId, outcome, actualPoints?, actualGift?, reason?, idempotencyKey })`
- `updateGoal(db, { actorId, assignmentId, revision, content, dueDate, expectedPoints?, expectedGift?, notes?, idempotencyKey })`
- `addGoalNote(db, { actorId, assignmentId, body, idempotencyKey })`
- `createManualPenalty(db, { actorParentId, studentId, points, reason, idempotencyKey })`
- `reverseManualPenalty(db, { actorParentId, studentId, adjustmentId, reason, idempotencyKey })`
- `getPointsPeriodSummary(db, { actorId, actorRole, studentId, from, through })`
- DB authorities: `goal_definitions`, `goal_assignments`, `goal_commands`, `manual_point_adjustments`, `point_ledger_entries`, `point_balance_projection`.

## 3. Contracts

- A parent-created definition creates one independent active assignment per selected subject. A student may create only a self assignment in `pending_approval`.
- Creating or first approving parent becomes the assignment's immutable responsible parent. Only that parent may evaluate it once.
- The state machine is `pending_approval -> active -> completed -> succeeded | failed`. Only the assignment subject may mark an active goal completed. Evaluation is allowed only after completion.
- `completed_by` and `completed_at` are immutable completion facts. New evaluated rows keep both facts; legacy terminal rows may keep both null. Every status rejects a half-populated completion pair.
- Expected points/gift are configuration. Actual points/gift and evaluation reason are terminal facts. Student goal rewards are non-negative `goal_reward` ledger entries; parent-personal goals never create student rewards.
- Core configuration uses optimistic `revision` and is editable only before any assignment of the shared definition is completed or terminal. A student may edit only their own pending proposal; the responsible parent may edit active configuration. After evaluation, only the responsible parent may append immutable `goal_notes`; completion and terminal facts are never overwritten.
- A manual penalty writes a negative `manual_penalty` entry only after locking the student and proving the deduction does not exceed the current projection. Its only correction is one equal positive `manual_penalty_reversal` by the original parent.
- Business write, ledger/projection update, audit, outbox, and idempotency result belong to one transaction.
- Period summaries classify schedule settlement/reversal, goal reward, and manual penalty/reversal, then return their net sum and the maximum positive frozen schedule outcome.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Parent has no current relationship to student | `FORBIDDEN` |
| Student submits a goal for another subject | Ignore caller subject list; create self proposal only |
| Actor is not the assignment subject, or goal is not active, when completing | `FORBIDDEN` / `STATE_CONFLICT` |
| Non-responsible parent evaluates | `FORBIDDEN` |
| Goal is not completed or is already terminal when evaluating | `STATE_CONFLICT` |
| Core edit revision is stale, or any shared assignment is completed/terminal | `STATE_CONFLICT` |
| Post-evaluation note is attempted before terminal state or by another actor | `STATE_CONFLICT` / `FORBIDDEN` |
| Student actual reward is negative/non-integer | `VALIDATION_ERROR` |
| Actual reward differs from expected without a 2+ character reason | `VALIDATION_ERROR` |
| Penalty is non-positive, non-integer, or reason is outside 2–200 characters | `VALIDATION_ERROR` |
| Penalty exceeds the locked balance | `STATE_CONFLICT`; no ledger or projection mutation |
| Path student does not own the adjustment | `NOT_FOUND` |
| Reversing parent is not original actor | `FORBIDDEN` |
| Adjustment already reversed | `STATE_CONFLICT` |
| Same idempotency key, different payload | `IDEMPOTENCY_CONFLICT` |

## 5. Good / Base / Bad Cases

- Good: student proposes, one linked parent approves and becomes responsible, the student marks completion, that parent evaluates success, and exactly one reward ledger entry updates the balance.
- Base: a parent completes their own personal goal and evaluates it with zero points and no gift; it creates no student ledger entry.
- Bad: reading the balance and later inserting a penalty without a shared row lock permits concurrent overdraft.

## 6. Tests Required

- Integration: two linked parents; first approves; subject completes; second cannot evaluate; first succeeds; fresh goal read contains responsible parent, completion facts, and actual reward.
- Integration: completion enforces subject authority, active-only state, live authorization where applicable, idempotent replay/conflict, concurrent serialization, one audit event, and one outbox event.
- Migration: pending/active/completed/new terminal/legacy terminal combinations enforce paired completion and evaluation fields, including rejection of half-populated terminal completion facts.
- Integration: two concurrent/serial parents cannot deduct past balance; only the original actor can reverse; second reversal is rejected; balance rebuild equals ledger sum.
- Integration: idempotent replay creates no duplicate assignment, reward, penalty, reversal, audit, or outbox fact.
- Unit: schedule maximum selects the highest finite numeric outcome and floors a wholly negative rule at zero.
- Route/UI: failures use nested M2 error responses and the critical `ErrorDialog`; penalty submission has client precheck plus confirmation but relies on the server lock as authority.

## 7. Wrong vs Correct

### Wrong

Let a parent complete a student's goal, evaluate an active goal before subject completion, update `point_balance_projection` directly, let any linked parent edit a completed/terminal goal, or delete a mistaken penalty.

### Correct

Append a typed ledger/adjustment fact under the responsible authority, update the projection in the same transaction, and correct only through an explicit reversing fact.
