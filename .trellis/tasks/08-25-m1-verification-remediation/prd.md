# M1 验收缺口修复 PRD

## 元信息

| 项 | 值 |
| --- | --- |
| 任务 ID | `m1-verification-remediation` |
| 分支 | `fix/m1-verification-gaps` |
| 基线 | 已完成任务 `.trellis/tasks/08-25-m1-identity-training-loop/`（**只读，不改写**） |
| 性质 | 修复 / 补齐，非新里程碑 |
| 门禁 | 负责人书面确认本 PRD + `design.md` + `implement.md` 后方可写业务代码 |

## Goal

在**保留既有 M1 后端 API 与已通过测试行为**的前提下，关闭 M1 质量审查与已批准 PRD 之间的验收缺口，使 M1 可在浏览器中完整演示，并消除已知安全/一致性缺陷（训练幂等键跨学生泄漏、缺失解除关联与 outbox、缺失 UI）。

## Background

- 后端纵向切片已交付：Identity、Family Access、Training（反应力）、最小审计；32 项 Vitest + 3 项 Playwright API E2E 通过（见 `m1-verification-evidence.md`）。
- 已批准 M1 PRD 仍要求：**浏览器可操作全链路**、**单方解除关联**、**outbox 占位同事务写入**、**360px 可用**、**路径 A 受控学生 + 首次改密**；当前实现以 HTTP API 为主，上述能力缺失或未验收。
- 审查发现 **P0 级缺陷**：`training_sessions.start_idempotency_key` / `submit_idempotency_key` 为**全局 UNIQUE**，服务层按 key 单一查询，不同学生复用同一 key 会拿到他人 session/指标。

## In Scope

### P1（必须）

#### R1 — 训练 start/submit 幂等键绑定学生与命令语义

- start 幂等键在 DB 与应用层均绑定 `(student_id, command=start, client_key)`。
- submit 幂等键绑定 `(student_id, session_id, command=submit, client_key)`（或等价复合语义，禁止全局唯一）。
- 不同学生使用相同 client key：**不得**返回他人 `sessionId`、状态或指标；应创建各自独立会话或返回 409/幂等冲突（按 design 选定）。
- 同一学生重复 submit/start：保持现有幂等回放行为。
- 迁移替换旧全局 UNIQUE 约束；expand-only，不丢历史 session 行。

#### R2 — 浏览器可操作 M1 主路径（含 360px）

用户可在 **375×667 或 360px 宽** 视口完成：

1. 家长邀请码注册
2. 家长联系方式验证（dev OTP）
3. 家长登录
4. 学生受控开户（路径 A，见 R6）或 E2E 预置学生登录
5. 学生生成关联码 → 家长输入码发起申请 → 学生接受
6. 学生完成一次反应力训练（键盘 Space/Enter 或点击）
7. 学生硬刷新后仍可读取同一会话结果
8. 家长查看已关联学生的训练汇总

页面/API 数据流见 `design.md`；不得仅靠 Postman/纯 API E2E 替代 R2 验收。

#### R3 — 单方解除关联

- 已关联家长或学生可发起解除（无需对方确认）。
- 解除后**立即**：`relationships.status=ended`；家长读学生 profile/training-summary **403**；`authorization_epoch` 递增；旧会话失效（与 accept 相同模型）。
- 同事务更新 `family_memberships.left_at` 投影；写审计；写 outbox（见 R4）。
- M1 仍为单家长单学生：解除后双方无 active relationship。

#### R4 — 事务 outbox 占位（无 Worker）

- 新增 `outbox_events` 表（对齐 `docs/data-model.md` 最小字段集）。
- 以下命令在**同一数据库事务**内写入领域事实 + `audit_events` + `outbox_events`：
  - 邀请消费（注册成功）
  - 关联接受
  - 关联解除
  - 训练 submit 完成（completed）
- **禁止**先 commit 事实再 best-effort 写 outbox。
- M1 不启动 Worker；事件保持 `pending`；提供只读调试查询或集成测试断言行存在即可。

### P2（必须，但可含明确延期决议）

#### R5 — Prettier / CI 格式

- `pnpm format` 在 CI 与本地通过（当前约 22 文件未格式化）。
- 不改动业务语义，仅格式与必要配置。

#### R6 — 5–12 岁受控学生创建与首次强制改密（M1 PRD 核对结论）

**核对结论（本任务 PRD 裁决）**：属于**已批准 M1 PRD In Scope**（路径 A +「5–12 岁学生首次登录必须修改初始密码」），**纳入本修复任务实现**，不得静默删除。

交付：

- 已验证家长 API：`POST /api/family/students` 创建学生（username、birth_date、初始密码）。
- 用户标记 `must_change_password=true`（或等价字段）。
- 学生首次登录后必须先改密方可进入训练/关联码等写操作；改密递增 `authorization_epoch` 并使其他会话失效。
- 集成测试 + 浏览器 E2E 覆盖「初始密码登录 → 强制改密 → 训练」。

**明确不在本任务**：路径 B（13–18 自助邀请注册）仍延后；在验收报告单独列出。

#### R7 — 管理员 TOTP（仅文档，不实现）

- M1 文档已延期（`m1-known-risks.md`、路线图「上线前阻断项」）。
- 本任务**不实现** TOTP UI/验证。
- 必须在 `research/m1-deferrals.md` 与最终验收报告保留：**生产发布阻断项**说明。

## Out of Scope

- 改写 `.trellis/tasks/08-25-m1-identity-training-loop/` 内任何文件
- 修改 `docs/` 下既有设计文档（可新增本任务 `research/` 工件）
- Stroop、数字广度、趋势图、计划、积分、多家长、私密总结
- outbox Worker、死信、投影重建 CLI（M3）
- 管理员 TOTP 实现
- 路径 B 学生邀请注册 E2E（建议项，单独延期记录）
- 关联码 10 分钟 / 申请 72h TTL 时钟注入测试（建议项）

## Acceptance Criteria

每条必须有**自动化测试**（Vitest 集成/单元或 Playwright）；编号与 `implement.md` 测试矩阵一致。

| ID | 条件 | 测试类型 |
| --- | --- | --- |
| **AC-R1a** | 学生 A、B 使用相同 start idempotency key 各自 start，得到不同 `sessionId`，且互不可见对方会话 | integration |
| **AC-R1b** | 学生 A 对 session X submit 的 key 不能让学生 B 获得 X 的指标回放 | integration |
| **AC-R1c** | 同一学生重复 start/submit key 仍幂等回放，不产生重复 completed/effective 行 | integration |
| **AC-R2a** | Playwright：家长注册 → 验证 → 登录 → 关联 → 可见学生汇总（360px 视口） | e2e |
| **AC-R2b** | Playwright：学生训练 → reload 结果页指标一致 | e2e |
| **AC-R2c** | Playwright：上述流程在 `viewport: 360×640` 通过 | e2e |
| **AC-R3a** | 解除后家长 GET profile/training-summary → 403 | integration |
| **AC-R3b** | 解除后家长旧 session cookie 访问敏感 API → 401/403 | integration 或 e2e |
| **AC-R3c** | 解除后 `relationships.status=ended`，membership `left_at` 已设置 | integration |
| **AC-R4a** | 注册/accept/end/submit-complete 各产生 ≥1 条 outbox，`dedupe_key` 唯一 | integration |
| **AC-R4b** | 模拟事务 rollback 时 outbox 与事实均不存在（savepoint 测试或失败注入） | integration |
| **AC-R5** | `pnpm format` exit 0；CI quality job 绿 | ci |
| **AC-R6a** | 家长创建 5–12 学生成功；返回 studentId | integration |
| **AC-R6b** | 初始密码登录后未改密不能 start training；改密后可以 | integration + e2e |
| **AC-R7** | 验收报告 + `research/m1-deferrals.md` 含 TOTP 延期与生产阻断声明 | 文档审查 |

## Non-Functional

- 迁移遵循 expand → deploy → contract；本任务仅 expand（新表、新索引、新列）。
- 现有 32 项 M1 集成测试在修复后仍须全部通过（除非因约束变更而**更新断言**，须在同一 PR 说明）。
- 移动端：主路径表单可点击、训练可 Space/Enter 提交。
- 审计仍不得写入明文 secrets。

## Assumptions

- 继续 Next.js App Router + Drizzle + Lucia + Vitest + Playwright + Tailwind。
- E2E 继续采用 port 3001 dev server 策略（或 CI build+start），与现有 `playwright.config.ts` 一致。
- 受控学生创建在 remediation 中首次引入 API；E2E 可组合「家长创建学生」而非仅 DB bootstrap。
- outbox payload 为类型化 JSON（aggregate id/type/event_version），M1 不含 PII 明文。

## 与历史 M1 任务关系

| 历史 M1 承诺 | 本任务动作 |
| --- | --- |
| API 层 Identity/Family/Training | **保留**，仅修正缺陷与补路由 |
| UI「必须能走通全链路」 | **补齐**（R2） |
| 单方解除关联 | **补齐**（R3） |
| outbox 占位 | **补齐**（R4） |
| 路径 A + 首次改密 | **补齐**（R6） |
| 管理员 TOTP | **不实现**；文档声明延期（R7） |
| 路径 B | **不实现**；验收报告延期 |

## Notes

- 实现阶段开始前须负责人确认本 PRD、`design.md`、`implement.md`。
- 完成后更新**本任务** `research/m1-verification-evidence.md`（新建），不回头改历史 M1 任务的 evidence 文件。
