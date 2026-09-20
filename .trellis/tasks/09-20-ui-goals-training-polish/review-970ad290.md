# Final implementation review — 970ad290

## Decision

**NO-GO.** Reviewed fixed implementation SHA `970ad29022f76b2624c43a03a3d4f52cc5455d22` against baseline `d5ab29831ba5a1b4c0457fa36a5ac40777754c09`.

The implementation has useful foundations (goal command/service, training review projection, shared labels, modal/theme hooks), but it does not satisfy the frozen UI behavior or evidence bar. All blockers below must be fixed in one concentrated remediation.

## Blocking findings

### B01 — Return navigation disappears on hidden-heading pages (P1)

`PageShell` renders `backHref` only in the visible-heading branch. Existing pages such as student plans, parent goals, parent plans, student schedule and parent student-management pages pass both `hideHeading` and `backHref`, so their return entry is removed rather than integrated with the title.

Required: give every `backHref` page one visible responsive title row containing the back control and the actual page title/actions. Preserve `onBeforeNavigate`, 44px target and dirty navigation guard. Do not solve this with another standalone row.

### B02 — Header placement and session ownership do not match R01 (P1)

The Shanghai clock is above the name (`flex-col`) instead of immediately left of it. The student home hero still renders its old date eyebrow, so the date was duplicated rather than moved. `PageShell` and `ShellIdentityCluster` also fetch session state independently.

Required: fetch cached session once in `PageShell`, pass it into the identity view, render clock then real name in one horizontal identity group, remove the redundant home date, retain account/role fallbacks and responsive truncation.

### B03 — Visible plan-level start dates remain (P1)

The shared standalone edit form was fixed, but the reachable student create/edit modal and parent copy modal still expose “开始日期”. The mobile footer also leaves the primary save button auto-width instead of a balanced full-width stack.

Required: remove the visible plan-level start date from every create/edit/copy path. New/copy uses current Shanghai date internally; edit preserves stored value. Once-entry dates remain visible. Use one consistent basic-info hierarchy and normal action footer.

### B04 — Generation dates are still clamped and can lock the user out of today (P1)

Parent selection/change handlers still rewrite `rangeFrom/rangeThrough` through `maxDate` and set input minima to the binding effective date. Student start input uses `min={rangeFrom}`, so after choosing a future day it cannot return to today.

Required: both clients use `min=today`, permit today-to-today, maintain only `through >= from`, never silently replace user input with the binding boundary, and display the server's effective-date error.

### B05 — Schedule completion dialog and calendar redesign are incomplete (P1)

Desktop duplicate mobile selectors are hidden, but the completion dialog still uses two plain buttons and the full-width primary action still squeezes cancel. Calendar hierarchy, intentional scrolling, themed states and the target responsive layouts lack browser evidence.

Required: implement the segmented completion-mode control, balanced desktop/mobile footer, clear focus/disabled states, and the complete day/week/month responsive design from `design.md`. Verify one intentional calendar scroller and no document horizontal overflow.

### B06 — Modal contrast is still structurally unsafe (P1)

`Modal` is portaled outside `.bd-shell`. Its dark space surface contains `Field` labels with `text-neutral-800` and inputs with hard-coded `bg-white` but inherited light text. The `.bd-shell` theme remapping therefore does not apply, so the original low-contrast/white-on-white class of defect remains.

Required: define modal-scoped semantic label/input/placeholder/disabled/select/textarea colors for both themes. Do not rely on `.bd-shell` descendant rules or parent opacity. Capture computed/visual evidence.

### B07 — Terminal completion-pair invariant is incomplete (P1)

The migration/schema require paired completion fields for `completed`, but `succeeded/failed` accept `completed_by` without `completed_at` and vice versa. This contradicts the frozen legacy-compatibility rule.

Required: terminal rows allow either both completion fields null (legacy) or both non-null (new), never half-populated. Update SQL, Drizzle check and migration constraint tests for both half-pair directions on terminal states.

### B08 — Training and goal verification matrices are incomplete (P1)

Training review tests cover reaction only. There is no Stroop/digit-span review test, session-level active/invalid suppression test, revoked-parent authorization test, completion-route contract test, changed-key conflict test or true concurrent goal completion test.

Required: add meaningful tests for all frozen cases. The parent training hub must also put its usage/disclaimer copy in the title aside instead of separate rows, matching the corresponding-page scope.

### B09 — Required browser and theme evidence is absent (P1)

The committed report has a pending SHA and explicitly records that focused Playwright and all candy/space screenshots were not produced. No E2E files changed for the new user-visible flows.

Required: add/run focused Playwright coverage at 360/768/1440 for header, back navigation, plan form/date behavior, schedule day/week/month and modal, goal complete→fresh read→parent evaluation, and all three training reviews. Capture candy and space evidence from the final fixed SHA and update the report truthfully.

## Verification performed

- Static fixed-SHA review of all changed production/test files.
- `git diff --check` on the fixed implementation diff passed.
- Cursor-reported focused tests, typecheck and lint were recorded, but do not cover the blockers above.
- Independent Vitest retry was intentionally prevented from using the pilot database; the sandboxed retry then hit `spawn EPERM`. No additional pass claim is made.

## Final-round rule

The acceptance line is frozen. The next handoff is the one concentrated remediation allowed by the collaboration protocol; after it, Codex will issue GO or terminal NO-GO without adding requirements.
