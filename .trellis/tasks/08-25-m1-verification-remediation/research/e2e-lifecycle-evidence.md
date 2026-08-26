# E2E WebServer 生命周期 — 可复现证据

> 分支 `fix/m1-verification-gaps` · 非交互式路径由 **监督器** 统一管理

## 架构

`pnpm test:e2e` → `tsx scripts/run-e2e.mts`（监督器）

```
try:
  pnpm build
  启动 next start（监督器持有 PID）
  等待 baseURL 就绪
  E2E_SUPERVISED=true playwright test（无 Playwright webServer）
finally:
  taskkill / 进程组 SIGTERM（仅监督器启动的 PID）
  assertPortFree(3002) — 无论 Playwright 成功/失败/中断均执行
```

Playwright 正常退出、非零退出、信号中断均由监督器 `finally` 清理，**不依赖** Playwright webServer teardown。

## 复现命令

```bash
pnpm test:e2e
pnpm test:e2e   # 连续第二次（Codex 签署前必跑）
```

## 实测结果（2026-08-26，监督器）

| 轮次 | 测试 | finally 端口检查 | 退出码 |
| --- | --- | --- | --- |
| 1 | 10 passed (1.3m) | `Port 3002: no LISTENING process` | 0 |
| 2 | 10 passed (1.3m) | `Port 3002: no LISTENING process` | 0 |

第二轮启动前 `assertPortFree` 通过（监督器 try 块首步），证明第一轮 finally 已释放端口。
