# Evidence closure review — 4e97b2b

## Decision

**NO-GO for push.** The production authorization and UI path are accepted. The remaining blockers are confined to deterministic browser proof and one incomplete dead-code cleanup.

## Accepted

- The family-scoped session route validates UUIDs, performs live `requireStudentReadAccess`, then loads a session owned by that student.
- Active parent access, revoked relationship, unrelated parent, active/cancelled/invalid suppression and raw-payload exclusion have integration coverage.
- Student and parent pages use the sanitized shared review component; the summary exposes a discoverable detail link.
- Goal complete -> fresh student read -> responsible-parent evaluation -> fresh parent read is deterministic.
- All committed screenshot paths exist and current candy/space pairs have different hashes.

## Blocking evidence gaps

### E01 — Responsive calendar proof is desktop-only (P1)

`tests/e2e/ui-goals-training-polish.spec.ts` exercises day/week/month and the completion modal only at 1440. The task requires calendar behavior at 360, 768 and 1440, including mobile selectors, one intentional scroller and no document horizontal overflow. The report also records that only `desktop-chromium` ran, while the frontend standard requires both configured viewport projects for layout changes.

### E02 — Modal focus and contrast assertions are incomplete (P1)

One Tab press only proves focus remains somewhere inside the dialog. Closing checks that the trigger is visible, not focused. The test must prove first/last focus wrapping, focus restoration to the exact trigger and an actual foreground/background contrast ratio rather than color inequality.

### E03 — Identity and training rows are under-asserted (P1)

The shell test checks only that the name/clock elements exist. It must assert the fixture display name, reject `我`, and validate the displayed Shanghai date/time. Training UI cases check only the review container and a metric; they must assert the per-type answer/expected/correctness row content.

### E04 — Theme evidence can regress or reuse stale files (P1)

The instruction requires re-asserting `html[data-theme]` after navigation and immediately before every capture. Goal captures omit both; later schedule captures omit the immediate assertion. Hash guards cover only shell and completion modal, leaving day/week/month, goal and training theme pairs unguarded. Generated evidence files must be cleaned or overwritten deterministically so a skipped capture cannot pass on a stale PNG.

### E05 — Goal-state visual evidence covers only active (P1)

The dual-theme goal capture occurs before completion and shows only the active state. The requirement covers active, completed/waiting-evaluation and evaluated result cards with textual labels plus distinct classes/colors. Assert and capture the state progression deterministically.

## Non-blocking cleanup required in the same correction

- `src/app/student/plans/page.tsx` replaces unused state with `const editing = null` but retains unreachable edit branches. Remove the dead branches instead of suppressing the warning with a constant.
- Run Prettier on only the files changed by this correction. Repository-wide `pnpm format` currently reports historical drift in many unrelated files; do not format unrelated files. Record both the focused Prettier result and the repository-wide result truthfully.

## Independent verification

- `pnpm typecheck`: passed.
- `pnpm lint`: passed with six pre-existing warnings and no warning in this change.
- `git diff --check 62b19d1...4e97b2b`: passed.
- Current screenshot pairs were independently hashed and differ.
- Repository-wide `pnpm format`: failed on 119 files, including some changed files; this is not a license to reformat the repository.

