# M1 执行计划

> **门禁**：负责人批准 `prd.md` 验收项与 `research/adr-0003-m1-tech-stack.md` 后，方可执行 `task.py start` 并编写业务代码。

> **实现状态（2026-08-25）**：后端 API + 集成/E2E 测试已完成；UI 页面、outbox、解除关联仍延后。详见 `research/m1-verification-evidence.md`。

## Phase 0 — 仓库 bootstrap（估计 0.5–1 天）

- [x] **0.1** 批准 ADR-0003 后，复制为 `docs/adr/0003-m1-tech-stack.md`
- [x] **0.2** 初始化 monorepo 根：`package.json`、TS strict、`eslint`、Prettier
- [x] **0.3** `docker-compose.yml`：PostgreSQL 16 + healthcheck
- [x] **0.4** Drizzle schema 骨架 + `drizzle-kit` migrate 脚本
- [x] **0.5** Next.js App Router 最小 `layout` / 错误页
- [x] **0.6** Lucia 安装与会话表迁移
- [x] **0.7** Vitest + Playwright + test DB 生命周期（`globalSetup` 跑迁移）
- [x] **0.8** CI 工作流：`lint` → `typecheck` → `vitest` → `playwright`

**验证**：`pnpm test` 通过；`pnpm dev` 可启动；迁移对空库可重复执行。

## Phase 1 — Identity 与邀请（估计 2–3 天）

- [x] **1.1** 迁移：`users`、`invitations`、`invitation_redemptions`、`login_security_events`；`guardian_consents` 在 Phase 2 accept 时写入（0004 迁移）
- [x] **1.2** Module：注册/验证/登录/登出/邀请
- [x] **1.3** 管理员 seed：`scripts/seed-m1.ts`
- [ ] **1.4** 页面：`/register`、`/verify-contact`、`/login`（仅 API）
- [x] **1.5** 登录锁定 + 审计写入
- [ ] **1.6** 家长创建 5–12 学生：`createControlledStudent`（测试 helper seed）
- [ ] **1.7** （可选）学生邀请码自助注册路径 B

**验证**：
- [x] 集成测：无效/过期/角色错误邀请码拒绝（AC-4）
- [x] 集成测：未验证家长发起关联 403（AC-5）

## Phase 2 — Family Access（估计 2–3 天）

- [x] **2.1** 迁移：family / relationship / codes / requests
- [x] **2.2** Module：关联码、申请 accept/reject（无解除关联）
- [x] **2.3** 事务内：`authorization_epoch++`、监护同意、`audit_events`
- [x] **2.4** 授权 `requireActiveRelationship` + epoch 校验（`validateSession`）
- [ ] **2.5** 页面：关联 UI
- [ ] **2.6** outbox 表写入（M3）

**验证**：
- [x] 集成测：pending 时家长读学生/训练 403（**AC-1**）
- [x] 集成测：同一码二次消费失败（**AC-2**）
- [x] 集成测：accept 后旧 session 失效（**AC-6**）

## Phase 3 — Training 反应力（估计 2–3 天）

- [x] **3.1** 迁移：training_* 表 + `users.birth_date`
- [x] **3.2** Seed：reaction v1 × 三个 age_band
- [x] **3.3** Module：start / events / submit / cancel|abandon；`reaction-v1`
- [x] **3.4** 每日 effective vs practice + 部分唯一索引
- [ ] **3.5** 训练 UI
- [ ] **3.6** 学生结果页 + 家长汇总页（仅 API）

**验证**：
- [x] 集成测：提交幂等、effective 唯一约束
- [x] E2E：完成训练 → 重读指标 → 家长汇总（**AC-3**）

## Phase 4 — 审计与收尾（估计 1 天）

- [x] **4.1** 审计覆盖 In Scope 动作（**AC-7**）；见 `tests/integration/audit/audit-coverage.test.ts`
- [ ] **4.2** 360px 冒烟：注册 → 关联 → 训练（UI 未做）
- [ ] **4.3** README 运行说明
- [x] **4.4** M1 验收证据：`research/m1-verification-evidence.md`

## 测试矩阵

| ID | 类型 | 场景 | 对应 AC | 状态 |
| --- | --- | --- | --- | --- |
| T-1 | integration | pending 家长读 profile/training-summary → 403 | AC-1 | 绿 |
| T-2 | integration | 关联码消费后再用 → 400 | AC-2 | 绿 |
| T-3 | e2e | 训练完成两次 GET 指标一致 | AC-3 | 绿 |
| T-4 | e2e | 家长 re-login 读汇总 | AC-3 | 绿 |
| T-5 | integration | 邀请码耗尽不增 user | AC-4 | 绿 |
| T-6 | integration | 未验证家长 POST 关联 → 403 | AC-5 | 绿 |
| T-7 | integration | accept 后 validateSession null | AC-6 | 绿 |
| T-8 | integration | audit 行存在且无 hash 明文 | AC-7 | 绿 |
