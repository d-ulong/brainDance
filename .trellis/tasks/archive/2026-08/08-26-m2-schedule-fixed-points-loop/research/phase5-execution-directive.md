# Phase 5 Execution Directive — Route Handlers

## 1. Active task 与固定基线

- Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
- 目标分支：`feat/m2-schedule-fixed-points-loop`
- 已签署业务基线：`ee54e601f39d2da9200028bfb885ca367fd4f9a2`
- 执行基线：包含本指令的 Codex 文档提交；Cursor 开始前必须记录其完整 SHA，且不得切换分支或改写历史。
- 本阶段唯一目标：实现 Phase 5 Route Handlers 及 API 集成测试。

## 2. 唯一必读文档

Cursor 实现前只按以下权威章节取数，不从聊天推断契约：

1. `implement.md` §1 Phase 5、§3.1、§4.2、§6 中与 Route/API 有关的 checklist；
2. `design.md` §7、§7.1；
3. `prd.md` AC-M2-F23；
4. `research/phase4-signoff.md`（确认上游签署基线）。

现有 M1 Route Handler、鉴权、DTO 与错误响应风格仅作为仓库惯例参考；若与上述 M2 文档冲突，以上述 M2 文档为准。

## 3. 允许修改范围

- `src/app/api/` 下实现 `design.md` §7 API 清单中的 M2 Route Handlers；
- 创建规划指定的 `src/app/api/_lib/require-idempotency-key.ts`；
- 为 HTTP 适配所必需的最小 DTO/Zod schema；优先放在既有模块或 route 邻近位置，并遵循仓库现有惯例；
- `tests/integration/api/` 下新增/更新 Phase 5 API 测试，至少包含 `write-route-idempotency-header.test.ts`；
- 更新本任务目录中的实施记录/验证矩阵，只记录本阶段真实完成情况。

Route Handler 只能做 HTTP 适配、鉴权、参数/DTO 校验、领域错误到 HTTP 的稳定映射，并调用已经签署的 Schedule/Settlement 模块接口。七类写 Route 必须在鉴权及 domain 调用前拒绝缺失或空白 `Idempotency-Key`，返回 `400`、`IDEMPOTENCY_KEY_REQUIRED` 和既有 M1 风格错误体。

## 4. 明确禁止

- 不修改 Phase 1–4 已签署的迁移或业务语义；若现有模块接口确实无法适配，停止并回报 blocker，不得自行重设计；
- 不实现或修改 Phase 6 Web 页面；
- 不实现 Phase 7 E2E；
- 不执行生产部署、合并、rebase 或 force-push；
- 不增加第三方依赖，不做无关重构、格式化或清理；
- 不把 `horizonThrough` 或任何领域规则复制到 Route Handler；
- GET/mount 路径不得调用 maintain-horizon 或产生写入。

## 5. 完成定义

- `design.md` §7 API 清单中的 M2 Route 均存在，并按角色、DTO、状态码和稳定错误码调用正确领域接口；
- §7.1 七类写 Route 对缺失与空白 `Idempotency-Key` 均在鉴权/domain 前返回规定的 400 错误；有效 header 原样传递给对应命令；
- API 测试覆盖成功路径、鉴权、DTO/参数错误、稳定领域错误映射，以及 AC-M2-F23 的全部七类写 Route；测试能证明缺 header 时 domain 未被调用；
- GET routes 是只读的，且不存在 mount/GET 隐式 maintain；
- 修改聚焦、无未说明 blocker，所有规定门禁通过；
- Cursor 创建一个聚焦 Git commit，并更新任务实施记录/验证矩阵中的 Phase 5 证据。

## 6. 必须运行的验证命令

按顺序运行并保留原始摘要：

```text
pnpm exec vitest run tests/integration/api
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <执行基线完整SHA>..HEAD
git status --short --branch
```

任何命令未执行或未通过都必须作为 blocker 回报，不得宣称完成或放行。

## 7. Cursor 固定回报格式

完成后提交，并严格按以下格式回报：

```text
SHA: <完整 40 位提交 SHA>
Execution baseline: <本指令所在完整 SHA>
Changed files:
- <path>: <用途>
Commands and raw results:
- <command>: <exit code + 原始测试/检查摘要>
Unresolved blockers:
- none | <blocker>
```

Cursor 只声明“Phase 5 实现已交 Codex 审核”，不得自行声明 GO、签署、归并或进入 Phase 6。
