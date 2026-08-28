# Phase 8 Remediation Round 2

> Active task: `.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Target branch: `feat/m2-schedule-fixed-points-loop`
> Execution baseline: `76a2d9189c51db73c5ba0a5df86dcbfb89b80d6e`
> Decision: **NO-GO — remediation only**

## 1. Scope and rules

This directive contains the complete actionable result of the fixed-SHA review at `76a2d9189c51db73c5ba0a5df86dcbfb89b80d6e`. Cursor may change only:

- `research/phase8-final-verification.md`

Do not modify product code, tests, migrations, schemas, routes, UI, E2E, dependencies, configuration, the verification matrix, prior signoff/remediation records, frozen IDs, or task history. Do not archive, merge, deploy, start another milestone, or claim final GO. Make one focused documentation commit and state only “submitted for Codex final review”.

## 2. Finding

### P8-R06 — Final evidence package denies its own remediation test changes and does not anchor them to the fixed SHA (P1)

- **Basis:** `phase8-remediation.md` P8-R03 required exactly two focused F8 integration tests; `AGENTS.md` §§4–5 require factual, locateable evidence and fixed committed SHAs as the source of truth.
- **Location:** `research/phase8-final-verification.md` header, §1 boundary table, and §2 Phase 8 SHA-chain row.
- **Issue:** The package still says “Phase 8 无业务/测试变更” and “未修改应用代码、测试…”, although commit `76a2d9189c51db73c5ba0a5df86dcbfb89b80d6e` adds the two F8 create/edit integration tests required by P8-R03. Its Phase 8 SHA-chain row also says only “本提交 SHA” and “仅文档”, so the evidence package does not identify the fixed commit containing the newly required acceptance evidence.
- **Required change:** Keep the signed **product implementation** SHA `9422c5fb6daf604ffeb6e7c527600f9d7562b391`, but state precisely that product code was unchanged while Phase 8 remediation added two focused F8 integration tests. Replace the prohibited-scope statement with an accurate statement that no product code, migrations, configuration, unrelated tests, or historical records changed, and that only the two authorized F8 tests plus verification documents changed. In the Phase 8 SHA-chain row, record the full fixed evidence/remediation SHA `76a2d9189c51db73c5ba0a5df86dcbfb89b80d6e` and describe the scope as the final matrix/evidence documents plus the two F8 remediation tests. Do not relabel `76a2d...` as the product implementation SHA.
- **Verification:** All three locations agree; `git show --stat 76a2d9189c51db73c5ba0a5df86dcbfb89b80d6e` matches the stated scope; no statement claims that Phase 8 or its remediation changed no tests.

## 3. Required verification and handoff

Run:

```powershell
git diff --check
git diff -- research/phase8-final-verification.md
git status --short --branch
```

Commit once, then run:

```powershell
git diff --check 76a2d9189c51db73c5ba0a5df86dcbfb89b80d6e..HEAD
git status --short --branch
```

Report exactly:

```text
Phase: 8 remediation round 2 — submitted for Codex final review
Commit: <full SHA>
Baseline: 76a2d9189c51db73c5ba0a5df86dcbfb89b80d6e
Resolved IDs: P8-R06
Changed files: research/phase8-final-verification.md
Commands: <raw concise result per required command, including post-commit diff-check>
Unverified: <none or exact boundary>
Blockers: <none or concrete blocker>
```
