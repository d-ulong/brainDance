# M2 Phase 3 最终测试断言补证

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 审核代码基线：`74c3ccf6cdbf359fe20a00ede4148ee943506f74`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 结论：NO-GO，仅剩 P3-R3-01

## P3-R3-01 — 精确证明并发 edit 仅创建一个 slot（P2）

- 位置：`tests/integration/schedule/formal-plan.test.ts` 约 504–509 行。
- 问题：当前查询使用 `.limit(1)` 并只断言 slot 存在，只能证明至少一个；即使并发错误创建多个 slot 仍会通过。P3-R2-02 明确要求保留“仅一个新 version/slot”的证明。
- 修订：查询 `results[0]!.versionId` 对应的全部 `planScheduleSlots`，严格断言长度等于 1，并断言唯一行的 `slotKey === "default"`。保留现有两个调用成功、一个 replay、单 version、单 audit、单 outbox 的断言。
- 范围：只允许修改 `tests/integration/schedule/formal-plan.test.ts`。不得修改业务代码、helper、`.trellis` 或其他文件。

必须运行：

```bash
pnpm exec vitest run tests/integration/schedule/formal-plan.test.ts
pnpm exec vitest run tests/unit/schedule tests/integration/schedule
pnpm typecheck
pnpm lint
pnpm format
git diff --check <executionBaseline>...HEAD
```

lint 只允许既有 3 个 warning。提交一个聚焦 commit，建议 `test(m2): assert single slot under concurrent edit`，不得夹带本文件。

固定回报：完整 SHA；修改文件；精确断言；命令原始结果；未执行项及原因；blocker（无则写“无”）。提交后等待 Codex 复审，不得宣称 Phase 3 GO。
