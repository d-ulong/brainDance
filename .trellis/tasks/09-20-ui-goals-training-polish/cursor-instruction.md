# Cursor implementation instruction

This is the only implementation instruction for the phase.

## Handoff contract

- Active task: `.trellis/tasks/09-20-ui-goals-training-polish`
- Branch: `main`
- Exact baseline SHA: supplied in the launch prompt. Stop if branch, HEAD or working-tree ownership differs.
- Read `prd.md`, `design.md`, `implement.md`, `implement.jsonl`, `check.jsonl` and `references/schedule-current.png` before editing.
- The screenshot is evidence of defects, not a target to reproduce.

## Scope

Implement every requirement R01–R07 and acceptance criterion AC01–AC10 in the task PRD. This includes the goal database migration/state machine, sanitized training answer projection, global shell identity/clock/back/heading layout, plan form and date behavior, responsive schedule redesign, themed modal contrast, tests and final evidence.

## Non-negotiable boundaries

- Preserve the manual schedule-generation model, existing plan binding authority and hidden plan start-date facts.
- Preserve goal outcomes `succeeded|failed`; introduce the `completed` intermediate state and require it before evaluation.
- Preserve existing historical terminal goal rows without fabricating completion metadata.
- Keep routes thin; domain authorization, locks, idempotency, audit, outbox and ledger/projection writes belong in services/transactions.
- Never expose raw training event payloads or training answers in logs, audit, outbox, error messages or unauthorized/active-session responses.
- Reuse protocol validation logic for answer review and one shared UI component for student/parent result pages.
- Do not weaken modal focus behavior, navigation dirty guards, theme switching, DTO typing or the C1–C4 lifecycle fixes from the archived task.
- Do not edit task status, PRD/design/instruction, `lessons.md` or `memo.md`. Do not stage unrelated pre-existing changes.
- Do not start another phase, push, merge, rebase, reset, deploy or alter credentials.

## Commit and report

- Produce exactly one focused business commit containing implementation, migration, tests and `implementation-report.md`.
- Report the full final SHA, concise changed-file summary, validation evidence and any unexecuted checks.
- Finish with “已交审核”; do not self-approve or claim GO.
