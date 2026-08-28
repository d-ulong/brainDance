# Owner-Authorized Development / E2E Port Separation

> Active task: `.trellis/tasks/00-bootstrap-guidelines`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Execution baseline: supplied by the Codex commit containing this directive
> Decision: **authorized implementation — submit for Codex review**

## 1. Goal

Commit the owner's existing, separately authorized port separation change as one focused configuration commit:

- the default development server listens on port **3002**;
- the default supervised E2E server and evidence tools use port **3003**;
- explicit `PLAYWRIGHT_PORT` and `PLAYWRIGHT_BASE_URL` environment overrides remain authoritative.

This is not part of Bootstrap guideline content and does not authorize Bootstrap finish/archive.

## 2. Exact allowed scope

Only these six already-modified files may be staged, changed, or committed:

- `.env.example`
- `package.json`
- `playwright.config.ts`
- `scripts/capture-desktop-parent-evidence.mts`
- `scripts/run-e2e.mts`
- `scripts/verify-e2e-port-free.mts`

Required end state:

| File | Required default |
| --- | --- |
| `.env.example` | `NEXT_PUBLIC_APP_URL=http://localhost:3002` |
| `package.json` | `dev` script is `next dev -p 3002` |
| `playwright.config.ts` | fallback `PLAYWRIGHT_PORT` is `3003` |
| `scripts/capture-desktop-parent-evidence.mts` | fallback base URL uses `3003` |
| `scripts/run-e2e.mts` | fallback `PLAYWRIGHT_PORT` is `3003` |
| `scripts/verify-e2e-port-free.mts` | fallback `PLAYWRIGHT_PORT` is `3003` |

Do not alter the explicit environment override behavior, product code, tests, Bootstrap specs, task documents, task status, journal, archives, dependencies, or Git history. Do not stage any `.trellis/` file. Do not merge, push, deploy, delete branches, finish, or archive tasks.

## 3. Verification and handoff

Before staging, inspect the exact six-file diff and confirm no other path is dirty. Then run serially:

```powershell
pnpm typecheck
pnpm lint
pnpm format
pnpm test:e2e
git diff --check
git status --short --branch
```

Stage only the six authorized paths by explicit name. Create exactly one commit:

```text
chore(dev): separate development and e2e ports
```

After committing, run:

```powershell
git diff --check <execution-baseline>..HEAD
git status --short --branch
```

Report exactly:

```text
Phase: owner port separation — submitted for Codex review
Commit: <full SHA>
Baseline: <full execution-baseline SHA>
Resolved IDs: PORT-01
Changed files: <the six paths, one per line>
Commands: <raw concise result for every required command>
Unverified: <none or exact boundary>
Blockers: <none or concrete blocker>
```
