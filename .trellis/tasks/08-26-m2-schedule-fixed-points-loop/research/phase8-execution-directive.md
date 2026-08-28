# Phase 8 Execution Directive — Final Verification Package

## 1. Fixed handoff

- **Active task:** `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
- **Target branch:** `feat/m2-schedule-fixed-points-loop`
- **Signed Phase 7 implementation:** `9422c5fb6daf604ffeb6e7c527600f9d7562b391`
- **Execution baseline:** the full SHA of the commit that adds this directive and `phase7-signoff.md`; report it exactly.
- **Single goal:** reconcile and complete the M2 final verification matrix and evidence package. Do not change product or test behavior and do not archive, merge, deploy, or claim final GO.

## 2. Required reading

1. `prd.md`: all AC-M2-1–AC-M2-8 and NF-1–NF-8.
2. `design.md` §10–§11; `implement.md` §4 and §6.
3. `research/m2-verification-matrix.md` §§1–7.
4. `research/phase1-consolidated-remediation.md`, `phase2-remediation.md`, `phase3-signoff.md`, `phase4-signoff.md`, `phase5-signoff.md`, `phase6-signoff.md`, and `phase7-signoff.md` for signed boundaries and fixed SHAs.

## 3. Allowed scope

- Update only `research/m2-verification-matrix.md` and create/update `research/phase8-final-verification.md`.
- For every AC-M2-1–AC-M2-8, F1–F28, and NF-1–NF-8, record a locateable test/evidence source and its final status; do not mark an item passed without evidence.
- Record the signed implementation SHA chain, exact verification commands, concise raw results, environment assumptions, and any unverified boundary.
- Re-run the required commands serially with port 3002 free; classify shared-environment failures only after an isolated serial rerun.
- Keep all statements factual and use status “submitted for Codex final review”, never final GO.

## 4. Prohibited scope

- Do not modify application code, migrations, schemas, routes, domain services, UI, E2E/unit/integration tests, helpers, dependencies, configuration, or prior phase sign-off/remediation records.
- Do not invent evidence, weaken acceptance criteria, renumber frozen IDs, rewrite historical command results, rebase, archive the task, merge, deploy, or begin another milestone.
- If any matrix row lacks evidence or any gate fails, record the exact blocker and stop; do not repair implementation in this phase.

## 5. Completion definition

1. The matrix contains no blank, ambiguous, or unsupported status for AC-M2-1–8, F1–F28, or NF-1–8.
2. `phase8-final-verification.md` identifies each signed phase SHA, maps every requirement family to locateable evidence, and distinguishes independently rerun results from inherited signed evidence.
3. Every required command exits 0, except the three already documented lint warnings; formatting makes no changes and final worktree status contains only the two authorized evidence documents before commit.
4. One focused documentation commit is submitted for Codex final review with no final-GO claim.

## 6. Required verification

```powershell
pnpm test:e2e
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <execution-baseline>..HEAD
git status --short --branch
```

## 7. Commit and report

Make one focused commit and report exactly:

```text
Phase: 8 final verification package — submitted for Codex final review
Commit: <full SHA>
Baseline: <full execution baseline SHA>
Covered IDs: AC-M2-1–AC-M2-8, F1–F28, NF-1–NF-8
Changed files: <one per line>
Commands: <raw concise result per required command>
Unverified: <none or exact IDs/boundaries>
Blockers: <none or concrete blocker>
```
