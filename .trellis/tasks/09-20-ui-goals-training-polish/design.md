# Technical design

## 1. Evidence-based UI diagnosis

The attached defect capture is preserved at `references/schedule-current.png`. It shows the current space theme at desktop width.

1. `ScheduleCalendar` always renders both `.bd-mobile-calendar-week` and `.bd-mobile-calendar-month`. Their base rules do not set `display: none`; they are only hidden inside the `max-width: 767px` media query. Both mobile pickers therefore appear on desktop and their 7/42 cells collapse into overlapping text.
2. The calendar toolbar, duplicate mobile selectors, timeline and nested day scroller compete for hierarchy. Date navigation is split across several rows and the active date has no stable visual anchor.
3. `Modal` uses a hard-coded white surface while its body inherits the theme foreground. In the space theme `--bd-text` is near-white, so labels and bare inputs become near-white on white. This is a semantic color-token defect, not a font-rendering problem.
4. Event colors are largely hard-coded light-theme colors. They neither harmonize with the space surface nor create a consistent status system across themes.
5. The completion dialog gives the primary action nearly the full row and compresses cancel into a narrow pill. Field grouping, selected mode, disabled controls and validation hierarchy are weak.

The screenshot is defect evidence, not a target composition. The target keeps the existing product functions but rebuilds their hierarchy and theme contracts.

## 2. Global shell

### Identity and clock

- `PageShell` owns an authenticated identity cluster when `showLogout` is true. Reuse the existing cached `fetchSession()` path rather than making every page thread identity props.
- Render `displayName || account || roleLabel`; never render “我”. Keep the account link accessible name specific, for example `账号：小宇`.
- Add a hydration-safe client clock formatted with `timeZone: "Asia/Shanghai"`, updating on the next minute boundary and then once per minute. Display `M月D日 周X HH:mm` to the left of the name. On 360px the clock may split into two compact lines; the name must remain visible.
- Do not show an authenticated identity or clock on login/register/public states.

### Page heading

- Replace the separate secondary/back row with one responsive heading contract: back button, title/copy, optional heading aside/actions.
- `secondaryNavigation` remains a separate navigation band when present; `backHref` belongs to the heading row.
- Add a generic `headingAside?: ReactNode` (or equally narrow contract) for training disclaimers/instructions. It is right-aligned at desktop and wraps below the title within the same header at mobile.
- Preserve `onBeforeNavigate`, App Router navigation, 44px targets, visible focus and current modal layering.

## 3. Plans and schedule

### Plan form

- Move priority into the basic information section and delete the “高级设置” disclosure.
- Hide only the plan-level `definition.startDate`. New plans continue to seed it with the current Shanghai date. Editing preserves the stored value. Once-entry dates remain editable and must not be conflated with plan start.
- Replace `.bd-plan-edit-actions` sticky/floating styling with a normal form footer: secondary cancel then primary save, right aligned on desktop and full-width stack on narrow mobile.
- Manual generation remains manual. Both `from` and `through` allow today. `through >= from`; the authoritative binding effective date remains a server constraint and produces a visible error rather than silently clamping the chosen date.

### Calendar information architecture

- Desktop toolbar: one row containing Today, previous/next, one clickable current-period label, and the Day/Week/Month segmented control. It may wrap once at tablet width but must not duplicate controls.
- Mobile toolbar: current-period label first, compact previous/Today/next group second, and a full-width segmented control. Only the selector matching the current view renders below it.
- Day view: clear time rail and event lane, one intentional scroll container, sticky day heading, readable event title/time/status/actions. Do not render mobile week/month selectors on desktop.
- Week view: seven columns inside a purposeful horizontal scroller only when the viewport cannot support the minimum column width. Day header remains sticky and never squeezes glyphs together.
- Month view: desktop uses a seven-column grid with stable cell height and compact event summaries; mobile uses a seven-column date picker plus the selected-day agenda list, never a 42rem desktop grid forced into 360px.
- Status tokens cover pending, in progress, completed and cancelled/skipped/expired for both themes. Every state has text or icon in addition to color. Use theme semantic tokens rather than white-mixed hard-coded surfaces.

### Modal theme contract

- Define modal surface/foreground/muted/border/input tokens for both candy and space themes, or use existing semantic surface/text tokens consistently. Modal descendants must not inherit a light foreground onto a light surface.
- All labels, input values, placeholders, disabled values and help copy meet readable contrast; avoid opacity on a parent containing text.
- Completion modal uses grouped fields, a real two-option segmented control, and balanced footer buttons. Desktop footer is right aligned; mobile actions stack with primary first visually without changing DOM semantics.
- Preserve focus trap, Escape behavior, backdrop click behavior, top-layer arbitration and focus restoration.

## 4. Goal state machine

### Authority and states

`goal_assignments` remains authoritative.

```text
pending_approval --responsible parent approves--> active
active --the subject marks complete-----------> completed
completed --responsible parent evaluates------> succeeded | failed
```

- Add nullable `completed_by` and `completed_at` facts. `completed_by` must equal the subject at service level. A parent completing their own personal goal is therefore valid; a parent cannot complete a student's goal.
- Add `POST /api/goals/[assignmentId]/complete`, a thin M2 route with Zod parsing, required `Idempotency-Key`, current session resolution and `toRouteErrorResponse`.
- `completeGoal` locks the assignment, checks/replays `goal_commands`, re-reads actor/subject authority, accepts only `active`, writes `completed`, command result, whitelisted audit metadata and outbox in one transaction.
- `evaluateGoal` accepts only `completed`. Only the immutable responsible parent may evaluate. Keep `succeeded|failed`, reward/gift/reason behavior and ledger/projection atomicity unchanged.
- DTO adds `completedAt` and `canComplete`; `canEvaluate` becomes true only for the responsible parent on `completed`. Editing freezes once any shared assignment is `completed` or terminal.

### Migration compatibility

- Add a new numbered SQL migration and matching Drizzle schema change. Extend the status check with `completed`.
- Existing `succeeded/failed` records remain valid without fabricated completion facts. The DB check must allow legacy terminal rows with both completion columns null, and new terminal rows with both set; it must reject half-populated completion pairs.
- `completed` requires both completion fields and no evaluation fields. `pending_approval/active` require no completion or evaluation fields. `succeeded/failed` require evaluation fields.
- Do not rewrite historical terminal assignments or ledger rows.

### UI semantics

- `pending_approval`: 待批准, neutral/lilac.
- `active`: 进行中, theme primary/blue.
- `completed`: 已完成 · 待评定, amber.
- `succeeded`: 已评定 · 达成, green.
- `failed`: 已评定 · 未达成, rose/neutral red.
- Student/subject sees “完成目标” only when `canComplete`; responsible parent sees “评定目标” only when `canEvaluate`.

## 5. Training review projection

- Do not return raw `training_events.payload`. Add a discriminated `TrainingTrialReviewDto` to the server and client session-detail contracts.
- Derive review rows beside the authoritative protocol validators so scoring/answer rules are not reimplemented in React:
  - reaction: trial index, prompt/expected action, actual action or timeout, correct, response time;
  - Stroop: word, ink color, expected color, selected color or unanswered, correct, response time;
  - digit span: mode, presented sequence, expected sequence, submitted sequence or unanswered, correct.
- Populate review only when the session is terminal `completed` and protocol validation is valid. Active, abandoned or invalid sessions return no answer review.
- Continue to use `authorizeTrainingSubject`, `assertSubjectReadable` and owned-session checks. Never add answer contents to logs, audit metadata, errors, outbox or screenshots committed as generic test output.
- Build one shared `TrainingSessionReview` component used by student and authorized parent result pages. Rows must remain legible at 360px without horizontal document scroll.
- Result heading shows the training title on the left and the disclaimer on the right. Training hub heading shows the two compact instruction lines on the right. On mobile these wrap inside the same heading region.

## 6. Failure and concurrency semantics

- Same idempotency key + same completion payload replays the original result. Same key + different payload is `IDEMPOTENCY_CONFLICT`.
- Two completion requests serialize on `FOR UPDATE`; one succeeds/replays and the other gets deterministic conflict if it is a different command.
- Evaluation racing completion cannot bypass the state order. Evaluation locks and sees either `active` (reject) or `completed` (proceed).
- A relationship becoming inactive blocks sensitive parent reads/evaluation at request time. Assignment responsibility alone is not sufficient authorization where the existing service requires a live family relation.
- UI waits for API success, then performs a fresh read; no optimistic terminal state.

## 7. Validation strategy

- Migration constraint test for all valid/invalid state/field combinations, including legacy terminal compatibility.
- Goal integration tests: subject completion, other student/parent forbidden, inactive relationship, state conflict, idempotent replay/conflict, concurrent completion, completion/evaluation order, exactly one audit/outbox, reward ledger unchanged.
- Route contract tests for the completion endpoint and missing idempotency key.
- Training service tests for three review unions, unanswered/timeout cases, active/invalid suppression, authorized parent and revoked relationship.
- Focused Playwright coverage for 1440/768/360: real header name/time, inline back button, plan form hierarchy, today-to-today generation, no duplicate calendar pickers, no document horizontal overflow, modal contrast/focus, goal complete-to-evaluate flow, and training answer review.
- Capture candy and space evidence for schedule day/week/month, completion modal, goal cards and training result. Evidence must record the final full SHA.
