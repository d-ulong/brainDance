# Bootstrap Guidelines Consolidated Remediation

> Active task: `.trellis/tasks/00-bootstrap-guidelines`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Reviewed implementation SHA: `4b1a91aa1d8f78910b222a80461f243453285504`
> Review baseline SHA: `886bcbf6c686102f9b844d77b7e10d95e90a4c3d`
> Decision: **NO-GO — remediation only**

## 1. Scope and rules

This directive contains every actionable finding from the fixed-SHA Standards and Spec review. Cursor may change only:

- `.trellis/spec/backend/directory-structure.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

Do not modify product code, tests, configuration, dependencies, scripts, indexes, other spec files, the PRD checklist, task metadata, journal, archives, or Git history. Do not finish or archive the Bootstrap task. Make one focused remediation commit and state only “submitted for Codex final review”.

The owner has confirmed that the six currently dirty paths listed in BG-R06 are separately requested parallel changes. They are not Bootstrap remediation files. Preserve their working-tree content byte-for-byte and do not stage or commit them with this task.

## 2. Findings

### BG-R01 — Route-layer guidance presents a preferred seam as universal current reality (P1)

- **Basis:** the Bootstrap PRD and `trellis-spec-bootstrap` require source-backed descriptions of current reality, not ideals.
- **Location:** `.trellis/spec/backend/directory-structure.md`, especially the route-layer description and anti-pattern section.
- **Issue:** the document says routes stay thin and delegate to services, but current routes including `src/app/api/auth/register/route.ts`, `src/app/api/auth/session/route.ts`, and `src/app/api/relationship-requests/route.ts` perform direct Drizzle reads or route-local orchestration.
- **Required change:** distinguish the dominant/preferred service seam for new behavior from the existing M1 route-local query exceptions. Cite the concrete exceptions and do not describe them as a pattern future code should copy. Preserve the rule that schema/domain invariants and transactional business behavior belong in modules.
- **Verification:** every absolute route-layer statement is true of the cited source, and the preferred direction is visibly separated from observed exceptions.

### BG-R02 — M1 Zod validation behavior is documented as implemented when it is not (P1)

- **Basis:** source-backed current-reality rule; verification guidance must be factual.
- **Location:** `.trellis/spec/backend/error-handling.md` validation and HTTP-mapping sections.
- **Issue:** M1 routes such as `src/app/api/auth/login/route.ts` call `bodySchema.parse`, while `src/lib/http-errors.ts::toErrorResponse` does not map `ZodError`; an uncaught parse error therefore falls through to the generic 500 path. “M1 routes should catch Zod explicitly” is an aspiration, not an established repository convention.
- **Required change:** document the actual M1/M2 difference and mark the M1 parse-to-500 behavior as a known inconsistency. Do not prescribe an unimplemented catch/mapping contract as current reality; state that changing it requires a separately authorized behavior task and regression tests.
- **Verification:** the text agrees with both cited files and does not imply that M1 Zod failures currently map to 400.

### BG-R03 — Hook guidance invents an unsupported future abstraction contract (P2)

- **Basis:** Bootstrap PRD Step 3 and `trellis-spec-bootstrap` prohibit aspirational or placeholder conventions; AGENTS §2 rejects speculative generality.
- **Location:** `.trellis/spec/frontend/hook-guidelines.md` “When to extract a custom hook”.
- **Issue:** the repository has no custom hooks, but the document invents `src/hooks/use-<name>.ts`, a “2+ pages” threshold, a fixed `{ data, loading, error, refetch }` return shape, and tells agents to copy a duplicated inline pattern.
- **Required change:** remove those unsupported directory, threshold, return-shape, and copying rules. Record only the evidenced current inline hook usage and a decision boundary: a task that introduces the first shared hook must explicitly establish and test its local convention rather than treating this bootstrap document as prior approval.
- **Verification:** no future custom-hook API or extraction threshold is presented as an existing convention.

### BG-R04 — State-management overview omits current `useRef` state (P2)

- **Basis:** source-backed current-reality rule.
- **Location:** `.trellis/spec/frontend/state-management.md` overview and state-category table.
- **Issue:** “All UI state is component-local via React `useState`” is false. `src/app/student/training/reaction/page.tsx` uses `useRef` for timing and imperative mutable state (`sequenceRef`, `stimulusShownAtRef`, `startedRef`).
- **Required change:** say UI state is component-local using React primitives, add the existing `useRef` category and cite the reaction-training page. Distinguish render-driving `useState` from non-rendering mutable/timing refs.
- **Verification:** the overview and table cover both observed state primitives without implying a global store exists.

### BG-R05 — Per-file E2E commands are ineffective (P1)

- **Basis:** `trellis-spec-bootstrap` requires reliable verification commands.
- **Location:** `.trellis/spec/frontend/component-guidelines.md`, `directory-structure.md`, `hook-guidelines.md`, and `state-management.md`.
- **Issue:** commands shaped as `pnpm test:e2e tests/e2e/<file>.spec.ts` do not select a file: `package.json` invokes `tsx scripts/run-e2e.mts`, and `run-e2e.mts` always spawns Playwright with only `["test"]` instead of forwarding `process.argv`.
- **Required change:** replace every ineffective per-file command with the supported full `pnpm test:e2e` command. Where a document wants a focused file, describe the file as coverage evidence rather than claiming the current supervisor supports focused selection. Do not modify the E2E runner in this task.
- **Verification:** `rg -n "pnpm test:e2e\\s+tests/" .trellis/spec/backend .trellis/spec/frontend` returns no matches, and all remaining commands are supported by the committed scripts.

### BG-R06 — Preserve six owner-authorized parallel changes outside this remediation (P1)

- **Basis:** the execution directive allowed only spec/PRD paths and required a clean worktree; AGENTS §§3–5 require focused commits and truthful handoff state.
- **Location:** uncommitted `.env.example`, `package.json`, `playwright.config.ts`, `scripts/capture-desktop-parent-evidence.mts`, `scripts/run-e2e.mts`, and `scripts/verify-e2e-port-free.mts`.
- **Issue:** the files change the development port from 3000 to 3002 and E2E defaults from 3002 to 3003. They are outside fixed commit `4b1a91a...`. The owner has now explicitly identified them as separately requested parallel work, so they must remain present but excluded from this remediation.
- **Required change:** do not edit, restore, stage, commit, stash, or otherwise alter these six files. Before and after the remediation, capture `git diff -- <six paths>` and confirm the patch is identical. Stage only the six authorized spec documents by exact path; never use `git add .` or `git add -A`.
- **Verification:** the remediation commit contains only the six authorized spec documents; the final working tree contains exactly the same six owner-authorized paths with the same diff and no additional paths. A non-clean status containing only these six paths is expected and is not a blocker.

## 3. Required verification and handoff

After recording the six-path owner diff for BG-R06, run:

```powershell
rg -n "Document your project's|To be filled|TODO: fill|placeholder|TBD|待填写|待补" .trellis/spec/backend .trellis/spec/frontend
rg -n "pnpm test:e2e\s+tests/" .trellis/spec/backend .trellis/spec/frontend
pnpm format
git diff --check
git diff -- .trellis/spec/backend/directory-structure.md .trellis/spec/backend/error-handling.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/directory-structure.md .trellis/spec/frontend/hook-guidelines.md .trellis/spec/frontend/state-management.md
git diff -- .env.example package.json playwright.config.ts scripts/capture-desktop-parent-evidence.mts scripts/run-e2e.mts scripts/verify-e2e-port-free.mts
git status --short --branch
```

Commit exactly once, then run:

```powershell
git diff --check 4b1a91aa1d8f78910b222a80461f243453285504..HEAD
git diff -- .env.example package.json playwright.config.ts scripts/capture-desktop-parent-evidence.mts scripts/run-e2e.mts scripts/verify-e2e-port-free.mts
git status --short --branch
```

Report exactly:

```text
Phase: Bootstrap Guidelines remediation — submitted for Codex final review
Commit: <full SHA>
Baseline: 4b1a91aa1d8f78910b222a80461f243453285504
Resolved IDs: BG-R01, BG-R02, BG-R03, BG-R04, BG-R05, BG-R06
Changed files: <one per line>
Commands: <raw concise result per required command>
Unverified: <none or exact boundary>
Owner parallel paths: <confirm the same six paths remain unstaged and byte-for-byte unchanged>
Blockers: <none or concrete blocker>
```
