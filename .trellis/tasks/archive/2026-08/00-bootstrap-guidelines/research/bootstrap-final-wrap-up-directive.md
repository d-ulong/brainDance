# Bootstrap Guidelines Final Wrap-up Directive

> Active task: `.trellis/tasks/00-bootstrap-guidelines`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Decision: **GO — archive and journal only**

## Single goal

Archive the completed Bootstrap Guidelines task and record the completed session. The Cursor prompt must supply the full SHA of the Codex commit containing this directive as the execution baseline.

The worktree must be clean before proceeding. Do not edit product code, tests, configuration, specs, task evidence, dependencies, or Git history. Do not merge, rebase, push, deploy, delete the branch, start another task, or archive any other task.

## Required procedure

1. Confirm target branch, exact execution baseline, an empty staged index, and a clean working tree.
2. Run `python ./.trellis/scripts/get_context.py --mode record`.
3. Archive only `00-bootstrap-guidelines` with `python ./.trellis/scripts/task.py archive 00-bootstrap-guidelines`; capture the archive commit SHA.
4. Record the session with `python ./.trellis/scripts/add_session.py --title "Bootstrap Guidelines and port separation complete" --commit "4b1a91aa1d8f78910b222a80461f243453285504,8ec971f6967c96b4d71f55b6b5661ba07e0d2f3c,d47732bfc8fa22318fa3ea9893372bba9a386efc,7ea190a40dfd3733d004e2ec21109ed47cb89ba7" --summary "Project-specific Trellis specs and the 3002 development / 3003 E2E port separation were independently reviewed and accepted."`; capture the journal commit SHA.
5. Confirm the task is archived with status `completed`, there are no active tasks, and the worktree and staged index are clean.

Only the normal task archive and journal bookkeeping commits are authorized.

## Required handoff

```text
Phase: Bootstrap Guidelines final wrap-up — completed
Execution baseline: <full SHA supplied in prompt>
Archive commit: <full SHA>
Journal commit: <full SHA>
Archived task path: <exact path>
Commands: <raw concise results for context, archive, journal, task list, status, and index>
Unverified: <none or exact boundary>
Blockers: <none or concrete blocker>
```
