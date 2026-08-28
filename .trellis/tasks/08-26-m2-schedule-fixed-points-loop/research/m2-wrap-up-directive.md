# M2 Wrap-up Directive

> Active task: `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Reviewed evidence SHA: `a159806d680051d7838efad034b8edbef2d3768d`
> Decision: **GO — archive and journal only**

## 1. Single goal

Complete the Trellis bookkeeping for the signed M2 task: archive this task and record the completed session. The exact execution baseline is the full SHA of the Codex commit containing this directive and must be supplied in the Cursor prompt.

Do not edit product code, tests, task evidence, specs, configuration, dependencies, or Git history. Do not merge, rebase, push, deploy, delete the branch, start another task, or archive any other task.

## 2. Required procedure

1. Confirm the branch and exact execution baseline from the Cursor prompt; stop on any mismatch.
2. Run `python ./.trellis/scripts/get_context.py --mode record` and `git status --porcelain`. Stop if the worktree is not clean.
3. Archive only `08-26-m2-schedule-fixed-points-loop` with `python ./.trellis/scripts/task.py archive 08-26-m2-schedule-fixed-points-loop`.
4. Capture the archive commit SHA. Record the session with `python ./.trellis/scripts/add_session.py --title "M2 schedule fixed points loop complete" --commit "<execution-baseline-full-SHA>" --summary "Codex fixed-SHA review accepted M2; all final quality gates passed; task archived."`.
5. Confirm the task is under the Trellis archive directory, the task status is no longer active, the journal record exists, and the worktree is clean.

The archive and journal commands may create their normal bookkeeping commits. No other commit is authorized.

## 3. Required handoff

Report exactly:

```text
Phase: M2 wrap-up — completed
Execution baseline: <full SHA supplied in prompt>
Archive commit: <full SHA>
Journal commit: <full SHA>
Archived task path: <exact path>
Commands: <raw concise result for context, status, archive, journal, and final verification>
Unverified: <none or exact boundary>
Blockers: <none or concrete blocker>
```
