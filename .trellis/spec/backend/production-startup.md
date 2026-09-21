# Production Startup

## 1. Scope / Trigger

Use this contract when changing or running the Windows production launcher after a code pull. It prevents new application code from running against an old database schema or an old `.next` build.

## 2. Signatures

- Launcher: `scripts\start-web-and-worker.bat start`
- Ordered commands: `pnpm db:migrate` → `pnpm build` → `pnpm start` and `pnpm worker:lifecycle`
- Authority: `DATABASE_URL` loaded by the production process environment / `.env.local`.

## 3. Contracts

- Stop the old web and worker before updating files.
- Back up the production database before applying new migrations.
- Run migrations before building and starting the new code.
- Always build the current checkout; an existing `.next\BUILD_ID` does not prove that the build matches the current Git revision.
- A migration or build failure exits before either long-running process starts.
- If `pnpm-lock.yaml` changed, run `pnpm install --frozen-lockfile` before the launcher.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Migration fails | Exit non-zero; do not start web or worker |
| Build fails or omits `.next\BUILD_ID` | Exit non-zero; do not start web or worker |
| Existing stale `.next` build | Rebuild; never treat its presence as current |
| New code reads a column from an unapplied migration | Deployment is blocked at migration; do not surface a runtime 500 |

## 5. Good / Base / Bad Cases

- Good: stop old processes, pull, frozen-install when needed, back up, run the launcher, then verify health and a schema-dependent page.
- Base: no dependency change; launcher applies idempotent migrations, rebuilds, and starts both processes.
- Bad: pull and run `pnpm start` against an existing `.next` directory while skipping migrations.

## 6. Tests Required

- Static launcher test asserts migration before build and both before process start.
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
