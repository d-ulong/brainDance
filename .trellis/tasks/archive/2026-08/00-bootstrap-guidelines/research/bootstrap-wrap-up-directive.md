# Bootstrap Guidelines Wrap-up Directive

> Active task: `.trellis/tasks/00-bootstrap-guidelines`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Reviewed remediation SHA: `8ec971f6967c96b4d71f55b6b5661ba07e0d2f3c`
> Decision: **GO — archive and journal only**

## Single goal

Archive the completed Bootstrap Guidelines task and record the session. The Cursor prompt must supply the full SHA of the Codex commit containing this directive as the exact execution baseline.

The following owner-authorized parallel paths must remain unstaged and byte-for-byte unchanged:

- `.env.example`
- `package.json`
- `playwright.config.ts`
- `scripts/capture-desktop-parent-evidence.mts`
- `scripts/run-e2e.mts`
- `scripts/verify-e2e-port-free.mts`

Do not edit, restore, stash, stage, commit, or format-write those files. Do not merge, rebase, push, deploy, delete the branch, start another task, or archive anything else.

## Required procedure

1. Confirm the target branch and exact execution baseline. Confirm status contains exactly the six paths above and nothing else; capture their full diff.
2. Run `python ./.trellis/scripts/get_context.py --mode record`.
3. Archive only `00-bootstrap-guidelines` with `python ./.trellis/scripts/task.py archive 00-bootstrap-guidelines`. Capture the auto-created archive commit SHA.
4. Record the session with `python ./.trellis/scripts/add_session.py --title "Bootstrap Guidelines complete" --commit "4b1a91aa1d8f78910b222a80461f243453285504,8ec971f6967c96b4d71f55b6b5661ba07e0d2f3c" --summary "Project-specific backend and frontend Trellis specs completed, independently reviewed, and archived."`. Capture the journal commit SHA.
5. Confirm the task is archived with status `completed`; no active tasks remain; the final status contains exactly the same six owner paths; their diff is identical to step 1; the index is empty.

Only the normal task archive and journal bookkeeping commits are authorized.

## Required handoff

```text
Phase: Bootstrap Guidelines wrap-up — completed
Execution baseline: <full SHA supplied in prompt>
Archive commit: <full SHA>
Journal commit: <full SHA>
Archived task path: <exact path>
Owner parallel paths: same six paths remain unstaged and byte-for-byte unchanged
Commands: <raw concise results for context, archive, journal, diff comparison, status, and index>
Unverified: <none or exact boundary>
Blockers: <none or concrete blocker>
```
