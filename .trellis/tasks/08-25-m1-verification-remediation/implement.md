# M1 验收缺口修复 — 执行计划

> **门禁**：负责人确认 `prd.md` + `design.md` + 本文件后，方可修改业务代码。  
> **分支**：`fix/m1-verification-gaps`  
> **不得修改**：`.trellis/tasks/08-25-m1-identity-training-loop/` 内任何文件

## Phase 0 — 准备（0.5 天）

- [ ] **0.1** 负责人书面批准 PRD / Design / Implement
- [ ] **0.2** 新建 `research/m1-deferrals.md`（TOTP、路径 B 延期记录）
- [ ] **0.3** 基线验证：`pnpm test` 32/32、`pnpm typecheck`、`pnpm lint` 记录起点

## Phase 1 — P1 后端修复（1–1.5 天）

### 1A 训练幂等键（R1 / AC-R1*）

- [ ] **1.1** 迁移 `0005_training_idempotency_scope.sql` + Drizzle schema 更新
- [ ] **1.2** 修改 `startTrainingSession` / `submitTrainingSession`：按 `(studentId, key)` 查询；submit 校验 sessionId
- [ ] **1.3** 新增 `tests/integration/training/idempotency-scope.test.ts`
  - 两学生同 start key → 不同 sessionId
  - 同学生同 key → replay
  - submit key 跨 session 拒绝

**验证**：`pnpm test tests/integration/training/idempotency-scope.test.ts`

### 1B 解除关联（R3 / AC-R3*）

- [ ] **1.4** 实现 `endRelationship` service + `POST /api/relationships/[id]/end`
- [ ] **1.5** 测试：ended 状态、403 读、epoch 会话失效、membership left_at
- [ ] **1.6** Playwright（可选同 Phase 3）：解除后家长 UI 看不到汇总

**验证**：`pnpm test tests/integration/family-access/end-relationship.test.ts`

### 1C Outbox（R4 / AC-R4*）

- [ ] **1.7** 迁移 `0006_outbox_events.sql` + `appendOutboxEvent`
- [ ] **1.8** 接入：registration、accept、end、submit-complete 四处事务
- [ ] **1.9** 测试：outbox 行存在 + dedupe；savepoint rollback 无 orphan outbox

**验证**：`pnpm test tests/integration/outbox/`

## Phase 2 — P2 后端 + 格式（0.5–1 天）

### 2A 受控学生与改密（R6 / AC-R6*）

- [ ] **2.1** 迁移 `0007_controlled_student_password.sql`
- [ ] **2.2** `POST /api/family/students` + `POST /api/auth/change-password`
- [ ] **2.3** 训练/关联写 API 增加 `must_change_password` 门禁
- [ ] **2.4** 集成测试 + 更新 E2E bootstrap

**验证**：`pnpm test tests/integration/identity/controlled-student.test.ts`

### 2B Prettier（R5 / AC-R5）

- [ ] **2.5** `pnpm format:write`（22 文件）
- [ ] **2.6** CI `pnpm format` 绿

## Phase 3 — 浏览器 UI + E2E（1.5–2 天）

- [ ] **3.1** 认证页：`/register`、`/verify-contact`、`/login`
- [ ] **3.2** 家庭页：`/parent/students/new`、`/parent/link`、`/student/link`
- [ ] **3.3** 训练页：`/student/training/reaction`、`/student/training/[sessionId]`
- [ ] **3.4** 家长汇总：`/parent/students/[id]/training`
- [ ] **3.5** 首页角色分流；360px Tailwind 冒烟
- [ ] **3.6** `tests/e2e/m1-browser-flow.spec.ts`（AC-R2*）
- [ ] **3.7** 保留/更新现有 API E2E，确保不回归

**验证**：

```bash
pnpm build
pnpm test:e2e
```

## Phase 4 — 验收与文档（0.5 天）

- [x] **4.1** 全量：`pnpm verify:m1-remediation`（或分步见 `VERIFICATION.md`）
- [x] **4.2** 编写 `research/m1-verification-evidence.md`（本任务专用）
- [x] **4.3** 独立复验入口：`VERIFICATION.md` + `research/reverification-signoff.md`
- [ ] **4.4** 更新本任务 `task.json` status → `completed`

## 测试矩阵（与 PRD AC 一一对应）

| AC | 测试文件 | 命令 |
| --- | --- | --- |
| AC-R1a–c | `tests/integration/training/idempotency-scope.test.ts` | vitest |
| AC-R2a–c | `tests/e2e/m1-browser-flow.spec.ts` | playwright |
| AC-R3a–c | `tests/integration/family-access/end-relationship.test.ts` | vitest |
| AC-R4a–b | `tests/integration/outbox/outbox-transaction.test.ts` | vitest |
| AC-R5 | CI `pnpm format` | ci |
| AC-R6a–b | `tests/integration/identity/controlled-student.test.ts` + e2e | vitest + playwright |
| AC-R7 | `research/m1-deferrals.md` 人工审查 | — |

## 回归要求

- 原 M1 集成测试全部通过（family-access、identity、training、audit）。
- 若断言因幂等 scope 变更需更新，须在 PR 描述说明原因。

## 回滚检查点

| Phase 完成后 | 动作 |
| --- | --- |
| Phase 1A | 可仅 revert 0005 + session.service |
| Phase 1B | 关闭 end 路由 |
| Phase 1C | outbox 表留空，移除 append 调用 |
| Phase 2 | 关闭 controlled student / change-password 路由 |
| Phase 3 | 移除 pages，API 仍可用 |

## 估算

**3.5–5 人日**（单全栈，含 UI + E2E + 迁移）

## 阻塞项

- 负责人批准本计划（当前阻塞）
- R6 若负责人改判「延期路径 A」，须修订 PRD AC-R6 为「文档延期」后再开发（默认：实现）

## Context 清单

实现阶段 curated entries：

- `design.md` §2–§9
- `src/modules/training/session.service.ts`
- `src/modules/family-access/relationship-request.service.ts`（accept 事务模式参考 end/outbox）
- `docs/data-model.md` outbox 节
- `CONTEXT.md` 关联解除、改密会话失效
