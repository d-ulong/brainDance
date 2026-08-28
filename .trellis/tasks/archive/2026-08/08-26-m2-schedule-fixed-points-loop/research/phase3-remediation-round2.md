# M2 Phase 3 整改复审补证指令

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 审核代码基线：`230c2ab11a20d756dd5f1e5d7bfcd500d1801a59`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 结论：NO-GO，仅剩测试证据补齐

## 1. 启动门禁

运行 `git branch --show-current`、`git rev-parse HEAD`、`git status --short --branch`。分支、执行基线和干净工作区必须与交接通知一致，否则停止并回报 blocker。

本回合只执行 P3-R2-01、P3-R2-02。生产修复方向已通过复审；除非真实竞争测试暴露生产缺陷，否则不得改业务实现。

## 2. 待完成项

### P3-R2-01 — 为 persist expired 建立真实、确定性的竞争回归（P1）

- 位置：`tests/integration/schedule/persist-expired.test.ts` 约 147–243 行。
- 未完成事实：现有 complete 与 skip 用例均先 `await` 终态命令，再调用 `persistExpiredPastWindow`；它们只证明非 pending 行不会更新，没有覆盖“persist 已 SELECT 到 pending ID，随后 complete/skip 提交，最后 persist UPDATE”的原始竞态。
- 修订动作：使用独立连接/事务与确定性 barrier，或最小的测试专用协调钩子，分别构造以下时序：
  1. expiration 已选中 pending candidate 后暂停；
  2. complete 或 skip 在另一连接提交；
  3. expiration 恢复执行 UPDATE；
  4. 最终状态仍为 completed/skipped，且对应 event/fact 等终态副作用保持唯一。
- 约束：禁止用 `setTimeout`、概率性 sleep 或仅 `Promise.all` 冒充确定性竞争；测试必须能够证明 barrier 已到达 SELECT→UPDATE 窗口。若需要生产侧测试钩子，只允许最小可注入 seam，不得改变默认生产行为或暴露到 API。
- 完成定义：complete、skip 两条测试各自可重复运行，并在修复前能够命中原竞态、修复后稳定证明终态不被 expired 覆盖。

### P3-R2-02 — 补齐 edit/deactivate 并发单副作用断言（P2）

- 位置：`tests/integration/schedule/formal-plan.test.ts` 约 449–527 行。
- 未完成事实：edit 并发用例断言 version/outbox，deactivate 断言 replay/outbox，但两者均未断言 audit 恰好一次；deactivate 还应明确核对计划终态与 future pending 取消结果。
- 修订动作：
  - edit×edit：按 action/resource 范围查询 `auditEvents`，断言恰好一条，同时保留两个调用成功、一个回放、仅一个新 version/slot 和一条 outbox。
  - deactivate×deactivate：断言恰好一条 audit、一条 outbox、plan 最终 inactive、目标 future pending 只发生一次语义上的 cancelled 终态，两个调用均成功且一个回放。
  - 保留同 key 异 payload 精确 `IDEMPOTENCY_CONFLICT` 覆盖。

## 3. 范围、验证与回报

允许修改：

- `tests/integration/schedule/persist-expired.test.ts`
- `tests/integration/schedule/formal-plan.test.ts`
- 仅 P3-R2-01 确有必要时，最小修改 `src/modules/schedule/persist-expired.service.ts` 或测试 helper

禁止修改 `.trellis`、API、schema/migration、其他领域与无关文件。

必须运行：

```bash
pnpm exec vitest run tests/integration/schedule/persist-expired.test.ts tests/integration/schedule/formal-plan.test.ts
pnpm exec vitest run tests/unit/schedule tests/integration/schedule
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <executionBaseline>...HEAD
```

lint 只允许既有 3 个 warning。提交一个聚焦 commit，建议 `test(m2): prove phase 3 concurrency contracts`，不得夹带本文件。

固定回报：完整 SHA；修改文件；P3-R2-01/P3-R2-02 对应测试名和确定性时序说明；所有命令原始结果；未执行项及原因；blocker（无则写“无”）。提交后等待 Codex 复审，不得宣称 Phase 3 GO。
