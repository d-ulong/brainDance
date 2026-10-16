# Production Startup

## 1. Scope / Trigger

Use this contract when changing or running the Windows production launcher after a code pull. It prevents new application code from running against an old database schema or an old `.next` build.

## 2. Signatures

- Launcher: `scripts\start-web-and-worker.bat start`
- Ordered commands: clean checkout/upstream check → `git pull --ff-only` → stop owned processes → `pnpm install --frozen-lockfile` → `pnpm db:migrate` → production `pnpm build` → web and worker.
- Implementation: the BAT entry delegates to `scripts/start-web-and-worker.ps1`; `dev` skips only production build.
- Authority: `DATABASE_URL` loaded by the production process environment / `.env.local`.

## 3. Contracts

- Pull before stopping services, as explicitly requested by the user. Dirty, detached, untracked-upstream, or pull failure must leave running services untouched. Never stash, reset, rebase, or force a pull.
- Stop only launcher-owned process trees, verified by recorded PID, creation time and the exact launcher path in the command line. Never kill by port or all Node processes. Older untracked launchers require manual closure once.
- Serialize launchers per checkout with an OS mutex. Store private local process state and logs under ignored `.review-runtime/windows-launcher/`.
- Back up the production database before applying new migrations.
- Run migrations before building and starting the new code.
- Always build the current checkout; an existing `.next\BUILD_ID` does not prove that the build matches the current Git revision.
- A migration or build failure exits before either long-running process starts.
- The launcher always runs `pnpm install --frozen-lockfile` after stopping owned processes and before migration.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Migration fails | Exit non-zero; do not start web or worker |
| Build fails or omits `.next\BUILD_ID` | Exit non-zero; do not start web or worker |
| Existing stale `.next` build | Rebuild; never treat its presence as current |
| New code reads a column from an unapplied migration | Deployment is blocked at migration; do not surface a runtime 500 |

## 5. Good / Base / Bad Cases

- Good: back up the database, run the launcher to check/pull/restart, then verify health and a schema-dependent page.
- Base: no dependency change; launcher applies idempotent migrations, rebuilds, and starts both processes.
- Bad: pull and run `pnpm start` against an existing `.next` directory while skipping migrations.

## 6. Tests Required

- Launcher tests assert pull-before-stop and migration/build/start ordering; executable Windows failure tests prove dirty/no-upstream/pull failures leave process state untouched and skip dependency/migration commands.
- Run migrations against an explicitly named isolated database and verify the newest required columns.
- Run a route test for a schema-dependent endpoint and a production build.
- After deployment, verify `/api/health` and one schema-dependent authenticated page.

## 7. Wrong vs Correct

### Wrong

```bat
if exist .next\BUILD_ID pnpm start
```

### Correct

```bat
call pnpm db:migrate || exit /b 1
call pnpm build || exit /b 1
pnpm start
```
