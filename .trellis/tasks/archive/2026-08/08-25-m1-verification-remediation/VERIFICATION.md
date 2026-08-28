# M1 验收缺口修复 — 独立复验指南

> **用途**：供 Codex / 审查者在 **`fix/m1-verification-gaps`** 分支上**独立**复验，并填写最终放行结论。  
> **勿改**：`.trellis/tasks/08-25-m1-identity-training-loop/`（历史 M1 任务，只读）。

## 快速定位

| 文档 | 路径 | 说明 |
| --- | --- | --- |
| **本指南（复验步骤）** | `VERIFICATION.md` | 你正在阅读的入口 |
| **首次验收证据** | `research/m1-verification-evidence.md` | 验收矩阵、测试结果、截图索引 |
| **放行结论（待填写）** | `research/reverification-signoff.md` | 复验完成后写入 GO / NO-GO |
| **延期项** | `research/m1-deferrals.md` | TOTP、路径 B 等明确不验收项 |
| **需求/设计** | `prd.md`、`design.md`、`implement.md` | 范围与 AC 来源 |

## 复验对象

| 项 | 值 |
| --- | --- |
| 分支 | `fix/m1-verification-gaps` |
| 基线提交（首次验收） | `117038211ffc966fb5405b0832d4434b2e8f7c64` |
| 任务 ID | `m1-verification-remediation` |

```bash
git fetch origin
git checkout fix/m1-verification-gaps
git log -1 --oneline   # 确认 HEAD ≥ 基线提交
```

## 前置条件

1. **Node / pnpm**：与仓库 `package.json` 一致（`corepack enable && corepack prepare pnpm@10.12.1 --activate`）。
2. **PostgreSQL**：可写测试库；在 `.env.local` 或环境中配置：
   - `DATABASE_URL`（必填，集成/E2E 测试依赖）
   - `SESSION_SECRET`（≥32 字符；E2E bootstrap 有默认值）
   - 可选：`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
3. **Playwright 浏览器**（若未安装）：`pnpm exec playwright install chromium`
4. **端口**：E2E 默认 `3002`（`playwright.config.ts`），避免与本地 `next dev` 3000/3001 冲突。

## 一键复验（推荐）

```bash
pnpm verify:m1-remediation
```

等价于按序执行：`db:migrate` → `test` → `typecheck` → `lint` → `format` → `build` → `test:e2e`。

## 分步复验（与 AC 映射）

### Step 0 — 迁移

```bash
pnpm db:migrate
```

预期：0005、0006、0007 已应用（幂等 scope、outbox、受控学生改密字段）。

### Step 1 — 自动化测试

```bash
pnpm test
```

| AC | 重点测试文件 | 预期 |
| --- | --- | --- |
| P1-1 | `tests/integration/training/idempotency-scope.test.ts` | 3 passed |
| P1-3 | `tests/integration/family-access/end-relationship.test.ts` | 7 passed |
| P1-4 | `tests/integration/outbox/outbox-transaction.test.ts` | 8 passed |
| P2/R6 | `tests/integration/identity/controlled-student.test.ts` | 3 passed |
| 回归 | identity / family-access / training / audit 等 | **合计 53 passed** |

### Step 2 — 静态检查与构建

```bash
pnpm typecheck && pnpm lint && pnpm format && pnpm build
```

预期：无错误；build 产出 26 个 app 路由（含 UI 页面与 API）。

### Step 3 — E2E（浏览器主路径）

```bash
pnpm test:e2e
```

| AC | 用例 | 预期 |
| --- | --- | --- |
| P1-2 | `m1-browser-flow.spec.ts` → full M1 path（desktop + mobile-360） | 2 passed |
| P1-2 | `m1-browser-flow.spec.ts` → horizontal scroll 360px | 2 passed |
| 回归 | `home.spec.ts`、`training-flow.spec.ts` | 6 passed |
| **合计** | | **10 passed** |

**P1-2 必须通过 UI 控件**（`m1-browser-flow`），不能仅用 `request.post` 替代。

可选：捕获补充截图（非门禁）

```bash
pnpm exec playwright test tests/e2e/m1-evidence-capture.spec.ts --project=desktop-chromium
```

输出目录：`research/screenshots/`。

### Step 4 — Git 卫生（可选）

```bash
git diff --check
git status --short
```

预期：无冲突标记；工作区干净（或仅含复验产生的本地文件）。

## 验收矩阵（摘要）

完整矩阵见 `research/m1-verification-evidence.md` §1。

| ID | 结论标准 |
| --- | --- |
| **P1-1** | 幂等键按 `student_id` 隔离；跨 session submit 409 |
| **P1-2** | 八步浏览器主路径 E2E 绿；360×800 无横向滚动 |
| **P1-3** | 解除关联后 403 + epoch 失效 + outbox/audit |
| **P1-4** | 四处事务写 outbox；dedupe + rollback 测试绿 |
| **P2-5** | `pnpm format` 绿 |
| **P2/R6** | 受控学生 + 强制改密 + 写 API 门禁；E2E 覆盖 |
| **R7** | **不验收实现**；确认 deferrals 中 TOTP 仍为发布阻断 |

## 首次验收结果（参考，非复验替代）

| 命令 | 2026-08-25 结果 |
| --- | --- |
| `pnpm test` | 53/53 |
| `pnpm test:e2e` | 10/10 |
| `pnpm lint` / `typecheck` / `build` / `format` | 通过 |

## 复验完成后

1. 在 **`research/reverification-signoff.md`** 填写：
   - 复验日期、执行者、HEAD 提交
   - 各 Step 实际输出（通过/失败）
   - **放行结论**：`GO` / `NO-GO` / `GO-WITH-CONDITIONS`
   - 残留风险与条件（如有）
2. 若 NO-GO：列出失败命令与日志片段，勿修改历史 M1 任务目录。

## 已知非阻断 / 延期（复验时确认文档仍存在即可）

- 管理员 TOTP：**未实现，生产阻断** → `research/m1-deferrals.md` §1
- 路径 B 学生自助注册：延期 → §2
- Outbox Worker：延期 M3 → §3
- Drizzle snapshot 缺 0005–0007：以 SQL 迁移为准

---

**相关提交消息**：`fix(m1): close verification gaps`
