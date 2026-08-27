# Phase 5 Consolidated Remediation — Round 1

## 1. 审核结论与固定基线

- 结论：**NO-GO**
- Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
- 分支：`feat/m2-schedule-fixed-points-loop`
- 执行指令基线：`070bb95b8a9fbc0d2836e77df189ec2fb5a8afeb`
- 被审核实现：`e47650667d5fd894c6b37c69bd72fbeec5e7eca6`
- 审核区间：`070bb95b8a9fbc0d2836e77df189ec2fb5a8afeb...e47650667d5fd894c6b37c69bd72fbeec5e7eca6`

本文档包含本轮 Standards 与 Spec 审核的**全部可执行发现**。Cursor 必须一次性完成全部项目；不得仅修测试断言来掩盖实现偏差。

## 2. 全部整改项

### P5-R01 — 统一修正 M2 错误响应体（P1 / Spec）

- 文件：
  - `src/app/api/_lib/require-idempotency-key.ts`
  - `src/app/api/_lib/to-route-error-response.ts`
  - 全部 M2 Route Handler 及其 API 测试
- 依据：`design.md` §7.1 明确响应体为 `{ error: { code, message } }`；`phase5-execution-directive.md` §3、§5。
- 问题：当前实现返回扁平 `{ error: string, code }`，F23 测试也固化了错误格式。
- 修订动作：所有 M2 Route 的 header、Zod、鉴权、领域及未知错误统一输出嵌套 envelope；稳定错误必须包含 `error.code` 和 `error.message`。HTTP status 与冻结映射保持一致，不泄漏未知异常。
- 验证：API 测试对 400/403/404/409/500 中实际可构造的代表场景断言完整嵌套结构；F23 精确断言 `{ error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "..." } }`。

### P5-R02 — 有效 Idempotency-Key 必须原样传递（P1 / Spec）

- 文件：`src/app/api/_lib/require-idempotency-key.ts`、七类写 Route、`tests/integration/api/write-route-idempotency-header.test.ts`
- 依据：`phase5-execution-directive.md` §5：“有效 header 原样传递给对应命令”。
- 问题：当前 `raw?.trim()` 的结果被作为 key 返回，改变了非空 header 的值。
- 修订动作：仅以 `raw.trim()` 判定缺失/空白；有效时返回并传递原始 `raw`，不得 trim、规范化或重编码。
- 验证：七类写 Route 各自使用带前后空格但非空的有效 header，spy 精确断言 domain 收到原始字符串。

### P5-R03 — 补齐 F23 七 Route × 两类无效 header 证据（P1 / Spec）

- 文件：`tests/integration/api/write-route-idempotency-header.test.ts`
- 依据：`phase5-execution-directive.md` §5；`prd.md` AC-M2-F23；`design.md` §7.1。
- 问题：七类写 Route 中只有 PATCH 覆盖空白 header，其余六条只覆盖缺失；尚未证明每条 Route 对“缺失”和“空白”都在鉴权/domain 前拒绝。
- 修订动作：以参数化或等价清晰结构覆盖 14 个组合；每个组合均断言 400、P5-R01 envelope、鉴权未进入、对应 domain 未调用。
- 验证：测试名称/参数输出能定位具体 method/path/header case，不能以仅测试共享 helper 代替 Route 级证据。

### P5-R04 — 动态路径参数实施稳定 DTO 校验（P1 / Spec）

- 文件：`src/app/api/_lib/m2-schemas.ts`、全部含 `[studentId]` / `[planId]` / `[itemId]` 的 M2 Route、API 测试
- 依据：`phase5-execution-directive.md` §3、§5 要求参数校验与稳定错误映射。
- 问题：路径参数直接进入 domain/DB；非法 UUID 可能成为驱动异常并返回 500。
- 修订动作：复用一个最小 UUID path-param schema，在进入 domain/DB 前验证三类 ID；非法参数返回 400 `VALIDATION_ERROR` 且符合 P5-R01 envelope。不得增加第三方依赖。
- 验证：至少分别覆盖 `studentId`、`planId`、`itemId` 非法值，并证明 domain/查询未调用。

### P5-R05 — 恢复 Module Interface 边界（P2 / Spec + Architecture）

- 文件：
  - 删除 `src/app/api/_lib/m2-read-queries.ts`
  - 在 `src/modules/schedule/`、`src/modules/settlement/` 的合适既有/最小查询 service 中承载对应查询
  - current-plan、balance、ledger Route 与测试
- 依据：`design.md` 顶部“Module Interface 优先”与 §3；`phase5-execution-directive.md` §3 要求 Route 调用已签署 Schedule/Settlement 模块接口。
- 问题：API `_lib` 直接查询 `plans`、`plan_schedule_slots`、`point_balance_projection`、`point_ledger_entries`，使业务查询越过模块边界。
- 修订动作：将 current formal plan 查询归入 Schedule module，将 balance/ledger 查询归入 Settlement module；Route 只负责 HTTP、鉴权、DTO 与调用模块接口。不改变已签署数据语义，不引入泛化 repository 层。
- 验证：`src/app/api` 的 M2 Route/适配层不再直接 import 这些业务表；现有及新增 GET API 测试通过并保持零写库。

### P5-R06 — 补齐 11 个 Route 的 Phase 5 API 验收矩阵（P1 / Spec）

- 文件：`tests/integration/api/m2-routes.test.ts`（可在 `tests/integration/api/` 内按职责拆分）及实施记录
- 依据：`phase5-execution-directive.md` §5：“design.md §7 API 清单中的 M2 Route 均存在，并按角色、DTO、状态码和稳定错误码调用正确领域接口”；API 测试须覆盖成功路径、鉴权、DTO/参数错误、稳定领域错误映射。
- 问题：当前实质覆盖 create/current/schedule-list/complete/balance；maintain、edit、deactivate、skip、ledger 无成功路径；point-rule 仅作 setup且未断言响应；角色、参数和领域错误映射仅覆盖少数 Route。
- 修订动作：建立可审计的 11 Route 矩阵，逐 Route 覆盖：
  1. 成功响应及关键 DTO；
  2. 该 Route 规定角色/关系的拒绝路径；
  3. 有 body/query/path DTO 时的 400；
  4. 有稳定领域错误的代表性非成功映射；
  5. 四个 GET 均证明只读且不触发 maintain；
  6. 七个写 Route 的 header 专项证据由 P5-R02/P5-R03 提供。
  测试可以参数化或共享 fixture，避免不必要重复，但不得用一条 Route 的行为替代另一条 Route 的证据。
- 验证：实施记录列出 11 Route → test name/case 的映射；`pnpm exec vitest run tests/integration/api` 全绿。

### P5-R07 — 简化 legacy error mapper 委派（P2 / Standards）

- 文件：`src/app/api/_lib/to-route-error-response.ts`
- 依据：AGENTS.md §2（优先复用已有实现、最小充分方案）；baseline smell：Duplicated Code / Divergent Change。
- 问题：当前重复识别 `IdentityError | FamilyAccessError | TrainingError`，并复制 `toErrorResponse` 的 unknown fallback；后续 legacy mapper 扩展会发生漂移。
- 修订动作：在满足 P5-R01 嵌套 envelope 的前提下，对非 Zod/Schedule/Settlement 错误直接委派 `toErrorResponse(error)`，再由单一 M2 adapter 转换为冻结 envelope；移除三项仅用于重复分派的 imports 和重复 fallback。不得改变 status/code/message。
- 验证：针对 legacy 鉴权错误与 unknown error 的 mapper/Route 测试证明 status 与嵌套 envelope 正确。

### P5-R08 — 删除未使用的测试 helper（P3 / Standards）

- 文件：`tests/integration/api/helpers/session.ts`
- 依据：AGENTS.md §2 YAGNI、§3 focused changes；baseline smell：Speculative Generality。
- 问题：`loginAsParent`、`loginAsStudent` 无任何消费者。
- 修订动作：删除两个 helper，并清理仅因其存在而需要的 imports；保留实际使用的 bootstrap/session helper。
- 验证：`rg -n "loginAsParent|loginAsStudent" tests` 无结果，API 测试与静态门禁通过。

## 3. 允许范围与禁止项

允许修改：上述 Route、`src/app/api/_lib/`、Schedule/Settlement 查询接口、`tests/integration/api/`、Phase 5 实施记录及本整改文档状态。

禁止：

- 不修改迁移或 Phase 1–4 已签署的命令/结算业务语义；
- 不进入 Phase 6 Web、Phase 7 E2E 或 Phase 8；
- 不增加依赖、泛化 repository/framework 或做无关重构；
- 不弱化断言、跳过测试或把异常统一吞成 500；
- 不自行声明 GO、签署或归并。

## 4. 完成定义与验证命令

P5-R01 至 P5-R08 全部完成并在本文档逐项标记完成；实施记录同步真实测试矩阵。按顺序运行：

```text
pnpm exec vitest run tests/integration/api
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check e47650667d5fd894c6b37c69bd72fbeec5e7eca6..HEAD
git status --short --branch
```

Cursor 创建一个聚焦整改提交，并按以下固定格式回报：

```text
SHA: <完整 40 位 SHA>
Remediation baseline: <本整改文档所在完整 SHA>
Resolved IDs: P5-R01, P5-R02, P5-R03, P5-R04, P5-R05, P5-R06, P5-R07, P5-R08
Changed files:
- <path>: <用途>
Commands and raw results:
- <command>: <exit code + 原始摘要>
Unresolved blockers:
- none | <blocker>
```

## 5. 本轮审核证据

- `git diff --check 070bb95...e476506`：通过。
- `pnpm exec vitest run tests/integration/api`：exit 0；2 files、14 tests passed，但因 P5-R02/P5-R03/P5-R04/P5-R06 覆盖缺口不足以签署。
- `pnpm typecheck`：exit 0。
- `pnpm lint`：exit 0；0 errors、3 个既有 warnings。
- `pnpm format`：exit 0。
- 完整 `pnpm test` 与 `pnpm build`：本轮在已确认 NO-GO 后未重复运行；Cursor 实施记录声称通过，但不作为本次 Codex 独立签署证据。
