# M2 Phase 4 最终 FK 身份断言修订

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 审核代码基线：`d7e0f8ef2392131ba259b32939cc9358b59301ef`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 结论：NO-GO；仅剩 P4-R4-01

## P4-R4-01 — 精确解析并恢复同一个 FK（P1）

- 位置：`tests/integration/settlement/settlement-ledger.test.ts` 的 `findForeignKeyConstraint`、`assertForeignKeyExists`。
- 问题：当前只匹配 public schema 下的源表/源列并 `LIMIT 1`，没有通过 `confrelid/confkey` 核对目标表/目标列；恢复检查只按 `conname`，也没有验证约束属于同一源/目标身份及 `convalidated=true`。
- 修订：helper 输入完整四元组 `sourceTable/sourceColumn/targetTable/targetColumn`；catalog 查询必须同时 join 源/目标 namespace、class、attribute，匹配单列 FK 的 `conkey/confkey` 对应位置，且结果严格恰好一条，不得 `LIMIT 1` 静默选取。返回包含 constraint name 与完整身份的结构。
- 两个 fixture 必须分别精确确认：
  - `fact_versions.schedule_item_id → schedule_items.id`
  - `point_balance_projection.last_ledger_entry_id → point_ledger_entries.id`
- sentinel rollback 后，使用相同四元组重新查询，断言同名 FK 恰好一条、`contype='f'`、`convalidated=true`，并可额外比较 `pg_get_constraintdef` 与 drop 前一致。
- 继续使用安全 identifier quoting；不得改变现有业务代码或测试语义。

范围只允许 `tests/integration/settlement/settlement-ledger.test.ts`，不得修改其他文件或 `.trellis`。

必须运行：

```bash
pnpm exec vitest run tests/integration/settlement/settlement-ledger.test.ts
pnpm exec vitest run tests/integration/settlement tests/integration/schedule
pnpm typecheck
pnpm lint
pnpm format
git diff --check <executionBaseline>...HEAD
```

lint 仅允许既有 3 warnings。提交一个聚焦 commit，建议 `test(m2): verify exact restored foreign keys`，不得夹带本文件。回报完整 SHA、修改文件、两个 FK 的完整 catalog 身份及恢复断言、所有命令原始结果、blocker（无则“无”）。等待 Codex 复审，不得宣称 Phase 4 GO。
