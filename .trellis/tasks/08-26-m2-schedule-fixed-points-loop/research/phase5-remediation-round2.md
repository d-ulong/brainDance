# Phase 5 Consolidated Remediation — Round 2

## 1. 审核结论与固定基线

- 结论：**NO-GO（仅验收证据缺口）**
- Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
- 分支：`feat/m2-schedule-fixed-points-loop`
- Round 1 指令基线：`34218a18976b6e1084daec0c278fe823df307e91`
- 被审核整改：`d4ab372607baae4fc3315324f9f36dd5cdef770c`
- 审核区间：`34218a18976b6e1084daec0c278fe823df307e91...d4ab372607baae4fc3315324f9f36dd5cdef770c`

Round 1 的生产实现、Standards 及 P5-R01/R02/R03/R05/R07/R08 已通过。本轮只有下述一个合并阻断项；本文档是 Round 2 的全部整改范围。

## 2. 唯一整改项

### P5-R2-01 — 闭合 11 Route 路径参数 400 与短路证据（P1 / Spec）

- 状态：**完成**

- 文件：
  - `tests/integration/api/m2-routes.test.ts`
  - `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/research/phase5-implementation-record.md`
  - 本文档状态
- 依据：
  - `phase5-remediation.md` P5-R04：非法 `studentId`、`planId`、`itemId` 必须返回 400，且证明 domain/query 未调用；
  - `phase5-remediation.md` P5-R06：11 Route 中凡存在 path/body/query DTO，均须有可审计的 400 证据。
- 问题：实现已在 Route 中调用 `m2UuidParamSchema.parse`，但测试证据尚未逐 Route 闭合：
  1. `POST maintain-horizon`：已有非法 `studentId` 400，缺 `maintainHorizon` 未调用断言；
  2. `PATCH formal-plans/[planId]`：已有非法 `planId` 400，缺 `editFormalPlan` 未调用断言；
  3. `POST formal-plans/[planId]/deactivate`：缺非法 `planId` 400 与 `deactivateFormalPlan` 未调用断言；
  4. `GET schedule-items`：缺非法 `studentId` 400 与 `queryScheduleItems` 未调用断言（现有非法 query 测试不能替代 path 证据）；
  5. `POST complete`：已有非法 `itemId` 400，缺 `completeScheduleItem` 未调用断言；
  6. `POST skip`：已有非法 `itemId` 400，缺 `skipScheduleItem` 未调用断言；
  7. `POST point-rules`：缺非法 `studentId` 400 与 `enablePointRule` 未调用断言（现有非法 body 测试不能替代 path 证据）。
- 保留并复核已闭合的四条 Route 证据：
  - `POST formal-plans` 非法 `studentId`；
  - `GET current` 非法 `studentId`；
  - `GET balance` 非法 `studentId`；
  - `GET ledger` 非法 `studentId`。
  这四条均须继续断言 400、嵌套 `VALIDATION_ERROR` envelope，并证明对应 domain/query 未调用。
- 修订动作：为上述七个缺口补最小、聚焦的测试/spy；最终形成 11 Route 全覆盖。所有 path 参数用非法 UUID，断言：
  1. HTTP 400；
  2. 响应严格匹配 `{ error: { code: "VALIDATION_ERROR", message: "Validation failed" } }`；
  3. 对应 domain/query spy `not.toHaveBeenCalled()`。
  同步实施记录的 11 Route 矩阵，删除 deactivate DTO 的 `—`，并为每一 Route 标出具体 invalid-path test name。

## 3. 允许范围与禁止项

允许修改仅限：

- `tests/integration/api/m2-routes.test.ts`；
- `research/phase5-implementation-record.md`；
- `research/phase5-remediation-round2.md` 的完成状态。

明确禁止：

- 不修改任何 `src/` 生产代码；当前实现已通过本轮逻辑审核；
- 不修改迁移、Phase 1–4、Web、E2E；
- 不扩大测试到与 P5-R2-01 无关的重构或 helper framework；
- 不删除、放宽或跳过现有测试；
- 不自行宣布 GO 或进入 Phase 6。

## 4. 完成定义与验证命令

- 11 个 Route 均有非法 path 参数的 400 + 精确 envelope + domain/query 未调用证据；
- P5-R2-01 标记完成，实施记录矩阵与实际 test name 一致；
- 创建一个聚焦提交，并按顺序运行：

```text
pnpm exec vitest run tests/integration/api
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check d4ab372607baae4fc3315324f9f36dd5cdef770c..HEAD
git status --short --branch
```

固定回报格式：

```text
SHA: <完整 40 位 SHA>
Remediation baseline: <本 Round 2 文档所在完整 SHA>
Resolved IDs: P5-R2-01
Changed files:
- <path>: <用途>
Commands and raw results:
- <command>: <exit code + 原始摘要>
Unresolved blockers:
- none | <blocker>
```

## 5. 本轮独立审核证据

- `git diff --check 34218a1...d4ab372`：通过。
- `pnpm exec vitest run tests/integration/api`：exit 0；2 files、62 tests passed。
- `pnpm test`：exit 0；40 files、271 tests passed。
- `pnpm typecheck`：exit 0。
- `pnpm lint`：exit 0；0 errors、3 个既有 warnings。
- `pnpm format`：exit 0。
- `pnpm build`：exit 0。

这些结果证明现有实现无已知回归，但不能替代 P5-R2-01 要求的逐 Route 负路径短路证据。
