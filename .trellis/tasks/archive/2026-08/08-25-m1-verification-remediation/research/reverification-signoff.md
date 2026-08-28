# M1 验收缺口修复 — 独立复验放行结论

> **填写说明**：由独立复验执行者（如 Codex）在跑完 `../VERIFICATION.md` 后填写。  
> **勿改**：`.trellis/tasks/08-25-m1-identity-training-loop/` 内任何文件。

## 元信息

| 字段 | 值 |
| --- | --- |
| 复验日期 | 2026-08-26 |
| 执行者 | Codex |
| 分支 | `fix/m1-verification-gaps` |
| HEAD 提交 | `7e72509` (`fix(e2e): spawn playwright CLI directly on Windows Node 24`) |
| 基线提交（首次验收） | `117038211ffc966fb5405b0832d4434b2e8f7c64` |
| 环境摘要 | Windows 本地工作区；Node v24.16.0；Docker PostgreSQL 16；`.env.local` 已配置。 |

## 命令执行结果

| Step | 命令 | 预期 | 实际 | Pass? |
| --- | --- | --- | --- | --- |
| 0 | `pnpm db:migrate` | 成功 | 成功；已有 drizzle schema/table 仅输出预期 NOTICE。 | 是 |
| 1 | `pnpm test` | 53/53 | 成功：12 个测试文件、53/53 通过，exit 0。 | 是 |
| 2a | `pnpm typecheck` | 无错误 | 成功。 | 是 |
| 2b | `pnpm lint` | 无错误 | 成功。 | 是 |
| 2c | `pnpm format` | 通过 | 成功。 | 是 |
| 2d | `pnpm build` | 成功 | 成功；26 条 App 路由。 | 是 |
| 3 | `pnpm test:e2e` | 10/10 | 两轮均成功：desktop + mobile-360 共 10/10，且每轮均输出 `Port 3002: no LISTENING process`。 | 是 |
| 4 | `git diff --check` | 无问题 | 工作区级检查通过；`git status --short` 为空。 | 是 |

说明：独立复验以受控后台方式运行同一 `pnpm test:e2e`，避免 Codex 命令执行器提前终止父 shell；两轮均取得完整退出与端口清理证据。

## AC 核对

| AC | 描述 | Pass? | 备注 |
| --- | --- | --- | --- |
| P1-1 / R1 | 训练幂等键按学生隔离 | 是 | 53 项 Vitest 包含同一 start key 的跨学生隔离及跨 session submit 409 回归。 |
| P1-2 / R2 | 浏览器八步主路径 + 360px E2E | 是 | 两轮均通过 desktop 与 mobile-360 真实页面控件流程。 |
| P1-3 / R3 | 单方解除关联 | 是 | 集成测试覆盖解除、即时 403、epoch 会话失效及幂等。 |
| P1-4 / R4 | 事务 Outbox 占位 | 是 | 集成测试覆盖关键事务、去重与回滚。 |
| P2-5 / R5 | Prettier / format | 是 | `pnpm format` 通过。 |
| P2 / R6 | 受控学生 + 强制改密 | 是 | 集成与浏览器 E2E 覆盖。 |
| R7 | TOTP **不实现**（deferrals 仍有效） | 是 | 已确认其仍为生产公网发布阻断项。 |

## 浏览器 / 截图（可选）

| 项 | 结果 |
| --- | --- |
| `m1-browser-flow` desktop 全路径 | Pass；两轮均通过。 |
| `m1-browser-flow` mobile-360 全路径 | Pass；两轮均通过且无横向滚动。 |
| 截图目录 `research/screenshots/` 已检视 | 已索引并提交。 |

## 最终放行结论

**结论（选一）**：

- [x] **GO** — 可合并/部署至非生产或继续下游流程
- [ ] **GO-WITH-CONDITIONS** — 条件允许放行（见下）
- [ ] **NO-GO** — 不可放行（见失败项）

### 条件 / 失败说明

无阻断项。此前非交互执行器中断父 shell 导致的 E2E 进程残留，已通过 `run-e2e.mts` 监督器及 Windows Node 24 直接执行 Playwright CLI 修复；独立两轮验证均通过并释放端口。

### 残留风险确认

- [x] 已阅读 `m1-deferrals.md`；**管理员 TOTP 仍为生产公网阻断项**
- [x] 路径 B、Outbox Worker 等延期项未误记为「已实现」

---

**签字/标记**：Codex，2026-08-26，`GO`。
