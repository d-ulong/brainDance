# E2E WebServer 生命周期 — 可复现证据

> 分支 `fix/m1-verification-gaps` · 非交互式路径（Codex/CI 同款 `pnpm test:e2e` 脚本链）

## 修复要点

1. **移除 tsx/pnpm wrapper**：Playwright `webServer.command` 直接 `node …/next start -p 3002`，由 Playwright 在非交互式退出时终止进程树。
2. **`pnpm build` 前置**：Playwright 在 `globalSetup` 之前启动 webServer，build 移入 `package.json` 的 `test:e2e` 脚本链。
3. **端口断言在 Playwright 完全退出之后**：`scripts/verify-e2e-port-free.mts`（非 globalTeardown，避免 teardown 顺序竞态）。

## 复现命令

```bash
pnpm test:e2e
pnpm test:e2e   # 连续第二次
```

## 实测结果（2026-08-26）

| 轮次 | 测试 | 端口 3002 | 退出码 | 日志 |
| --- | --- | --- | --- | --- |
| 1 | 10 passed (1.4m) | `Port 3002: no LISTENING process` | 0 | `research/e2e-run1.log` |
| 2 | 10 passed (1.3m) | `Port 3002: no LISTENING process` | 0 | `research/e2e-run2.log` |

未 skip 用例、未手动 taskkill 无关进程。

## 变更文件

- `package.json` — `test:e2e` 脚本链
- `playwright.config.ts` — 直接 next start + E2E env（无 NODE_ENV=development 污染）
- `scripts/verify-e2e-port-free.mts` — 退出后端口检查
- 删除 `scripts/e2e-web-server.mts`
