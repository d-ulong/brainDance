# M2 Phase 4 最终异常夹具补证

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 审核代码基线：`2485a983e15bbd0392ddd576acb982864cb4e1c3`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 结论：NO-GO；真实 settlement/ledger 竞争已通过，仅剩 P4-R3-01～03

## 1. 启动与范围

运行 `git branch --show-current`、`git rev-parse HEAD`、`git status --short --branch`；分支、执行基线与干净工作区必须一致，否则停止。

只允许修改 `tests/integration/settlement/settlement-ledger.test.ts` 和为移除测试 API 所需的 `src/modules/settlement/settlement.service.ts`。不得修改业务行为、其他文件、schema/migration、API、`.trellis` 或依赖。

异常 FK fixture 必须完全包在测试事务中：在 outer transaction 内临时 drop 对应 FK、构造不可能由正常写路径产生的异常状态、通过正式 public service 执行断言，最后主动抛出测试 sentinel 使 outer transaction 回滚，从而自动恢复约束和数据。开始前用 `pg_constraint` 精确解析并确认目标 constraint；不得在已提交状态永久修改 schema，不得依赖测试顺序。

## 2. 全部剩余项

### P4-R3-01 — 覆盖 fact 存在但关联 item 不可加载（P1）

- 当前 fact-missing 不是该分支；必须保留 fact，同时让其 `schedule_item_id` 指向一个不存在/不可加载的 item。
- 推荐在 outer transaction 内临时 drop `fact_versions.schedule_item_id → schedule_items.id` FK，删除目标 item 或把 fact FK 值改为不存在 UUID，然后调用正式 `settleForFact(tx,{factVersionId})`。
- 精确断言 `STATE_CONFLICT`；调用前后 settlement、ledger、balance、ledger audit、settlement outbox 完全相同（异常 fixture 本身的预备变化不计入 service 副作用）。随后以 sentinel 回滚整个 outer transaction，并在事务外确认 FK 仍存在。

### P4-R3-02 — 通过正式 service 验证所有权威数据保护（P2）

- 删除 `loadFactSettlementContext` 的 public export；它保持模块私有。
- fact missing、student mismatch、item unavailable 三种测试都调用 `settleForFact`，不得直接调用内部 helper。
- 每个用例都用完整 state snapshot 比较 settlement、ledger、balance、audit、outbox；fact missing 不得只查两张表。
- completion_kind 由数据库 CHECK 阻止非法 fixture 的现有证据可保留。

### P4-R3-03 — missing-ledger 回放保留原始 balance/lastLedgerEntryId（P2）

- 当前先把 `lastLedgerEntryId` 置 NULL，掩盖了明确要求检查的状态。
- 在 outer transaction 内临时 drop `point_balance_projection.last_ledger_entry_id → point_ledger_entries.id` FK，再删除 ledger；不得修改 balance 或 lastLedgerEntryId。
- 记录完整异常状态（balance 仍为 10，lastLedgerEntryId 仍为原 ledger ID，ledger 行缺失）；调用正式 `completeScheduleItem` 回放，精确 `STATE_CONFLICT`；断言完整 before/after 相等且未补写 ledger、audit、outbox。以 sentinel 回滚并在事务外确认 FK 仍存在。
- 若实际约束名与预期不同，通过 catalog 查找 FK OID/名称，不得硬猜；DDL 标识符必须安全引用。

## 3. 必须验证与回报

```bash
pnpm exec vitest run tests/integration/settlement/settlement-ledger.test.ts
pnpm exec vitest run tests/integration/settlement tests/integration/schedule
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <executionBaseline>...HEAD
```

lint 仅允许既有 3 warnings。提交一个聚焦 commit，建议 `test(m2): prove phase 4 corrupted-state guards`，不得夹带本文件。

固定回报：完整 SHA；修改文件；P4-R3-01～03 测试名；两个事务内 FK 异常 fixture、sentinel rollback 与约束恢复证据；全部命令原始结果；未执行项及原因；blocker（无则“无”）。等待 Codex 复审，不得宣称 Phase 4 GO。
