# Owner Port Separation Remediation

> Active task: `.trellis/tasks/00-bootstrap-guidelines`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Execution baseline: `d47732bfc8fa22318fa3ea9893372bba9a386efc`
> Decision: **NO-GO — remediation only**

## 1. Scope and rules

This directive contains every actionable finding from the fixed-SHA review. Cursor may change only:

- `.trellis/spec/frontend/quality-guidelines.md`

Do not modify product code, tests, configuration, scripts, other specs, task documents, task status, journal, archives, dependencies, or Git history. Do not merge, push, deploy, finish, or archive any task. Create one focused documentation commit and state only “submitted for Codex final review”.

## 2. Finding

### PORT-R01 — Frontend E2E guideline retains the obsolete default port (P2)

- **Basis:** `trellis-spec-bootstrap` requires project specs to describe current reality; `AGENTS.md` §§3–5 require focused, internally consistent changes and verifiable outcomes.
- **Location:** `.trellis/spec/frontend/quality-guidelines.md`, E2E setup section.
- **Issue:** the guideline says the default supervised E2E server uses port `3002`, while the accepted fixed implementation commit `d47732bfc8fa22318fa3ea9893372bba9a386efc` sets the E2E/evidence fallback port to `3003` in `playwright.config.ts`, `scripts/run-e2e.mts`, `scripts/verify-e2e-port-free.mts`, and the evidence capture script. The default dev server remains port `3002`.
- **Required change:** state the exact split: `pnpm dev` defaults to `3002`; `pnpm test:e2e` supervises its default server on `3003`; `PLAYWRIGHT_PORT` and `PLAYWRIGHT_BASE_URL` explicitly override their respective E2E defaults. Cite `package.json`, `playwright.config.ts`, and `scripts/run-e2e.mts`. Do not describe any other port behavior.
- **Verification:** the quality guideline and cited source agree exactly; `rg -n "3002|3003|PLAYWRIGHT_PORT|PLAYWRIGHT_BASE_URL" .trellis/spec/frontend/quality-guidelines.md` is internally consistent; no other file changes.

## 3. Required verification and handoff

Run:

```powershell
rg -n "3002|3003|PLAYWRIGHT_PORT|PLAYWRIGHT_BASE_URL" .trellis/spec/frontend/quality-guidelines.md
pnpm format
git diff --check
git diff -- .trellis/spec/frontend/quality-guidelines.md
git status --short --branch
```

Commit once, then run:

```powershell
git diff --check d47732bfc8fa22318fa3ea9893372bba9a386efc..HEAD
git status --short --branch
```

Report exactly:

```text
Phase: owner port separation remediation — submitted for Codex final review
Commit: <full SHA>
Baseline: d47732bfc8fa22318fa3ea9893372bba9a386efc
Resolved IDs: PORT-R01
Changed files: .trellis/spec/frontend/quality-guidelines.md
Commands: <raw concise result per required command>
Unverified: <none or exact boundary>
Blockers: <none or concrete blocker>
```
