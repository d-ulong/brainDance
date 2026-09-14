# Dependency Recovery

> Safe recovery contract for a damaged generated dependency tree on Windows.

## 1. Scope / Trigger

Use this procedure when `pnpm dev`, tests, typecheck, or lint fail because a package file declared by an installed dependency is missing. This is an environment repair, not a reason to change application source or the lock file.

## 2. Signatures

- Exact install: `pnpm install --frozen-lockfile`
- Application feedback loop: `pnpm dev`
- Runtime probe: HTTP GET `/` and one HTML-referenced `/_next/static/...` asset.
- Generated targets, after absolute-path verification: `<workspace>/node_modules` and, only when proven corrupt, the project-local pnpm store.

## 3. Contracts

- Preserve `package.json`, `pnpm-lock.yaml`, source files, `.env*`, databases, and application data.
- Before recursive removal, resolve every target to an absolute path and prove it is a child of the intended workspace.
- Stop processes that hold generated dependencies before removal.
- Removal and installation form one gate: do not install unless every intended target was completely removed.
- Use the repository's configured stable runtime and the frozen lock file. Do not add, upgrade, or patch a dependency merely to make a checker start.
- Success requires the original command path to pass. A root-level `require()` of a transitive dependency is not a valid substitute for `pnpm dev`.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Resolved target is outside the workspace | Abort before removal |
| Port/process still holds the dependency tree | Stop or abort; never partially remove |
| Recursive removal reports access denied or leaves the target present | Abort; do not run install over the partial tree |
| Frozen install changes `package.json` or `pnpm-lock.yaml` | Treat as failure and investigate |
| Package directory exists but declared entry file is absent | Dependency tree remains red |
| `pnpm dev` reaches Ready but `/` or referenced static asset is non-200 | Recovery remains incomplete |

## 5. Good / Base / Bad Cases

- Good: verify exact generated paths, remove them successfully with sufficient permissions, frozen-install once, start the app, then check page and static asset responses.
- Base: a missing transitive package file is restored without any tracked-file changes.
- Bad: ignore `Remove-Item` access-denied output, install over a half-deleted tree, then report typecheck or a package-directory probe as proof the app starts.

## 6. Tests Required

- Re-run the exact user command and assert the process reaches Next `Ready` without `next.config` load failure.
- Request `/` and one actual static path extracted from its HTML; both must return 200.
- Confirm `git status -- package.json pnpm-lock.yaml .npmrc` is empty.
- If a minimal missing-module probe was used, confirm the installed package now contains that declared file; keep the real startup command as the final authority.

## 7. Wrong vs Correct

### Wrong

```powershell
Remove-Item node_modules -Recurse -Force # access denied is ignored
pnpm install --force                    # overlays a partial tree
```

### Correct

```powershell
$target = (Resolve-Path -LiteralPath 'node_modules').Path
if (-not $target.StartsWith($workspaceRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'unsafe target' }
Remove-Item -LiteralPath $target -Recurse -Force
if (Test-Path -LiteralPath $target) { throw 'dependency removal incomplete' }
pnpm install --frozen-lockfile
```

