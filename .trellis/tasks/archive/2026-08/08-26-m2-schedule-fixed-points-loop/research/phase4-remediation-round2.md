# M2 Phase 4 整改复审 — 最终并发与不变性补证

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 审核代码基线：`a711a4da0d84a8d59c731bafc6cba1b77af5dbb4`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 结论：NO-GO；生产实现方向已通过，仅剩以下完整测试证据

## 1. 启动与范围

运行 `git branch --show-current`、`git rev-parse HEAD`、`git status --short --branch`；分支、执行基线、干净工作区必须一致，否则停止并回报 blocker。

只完成 P4-R2-01～P4-R2-04。允许修改 `tests/integration/settlement/settlement-ledger.test.ts`；只有为 P4-R2-01 建立确定性 barrier 确有必要时，才允许最小修改 `src/modules/settlement/settlement.service.ts`、`ledger.service.ts`，且测试 seam 默认生产路径必须无行为变化。不得修改其他文件、`.trellis`、schema/API 或依赖。

## 2. 全部剩余项

### P4-R2-01 — 真正命中 settlement 与 ledger 唯一约束竞争（P1）

- 未完成事实：当前 settlement 用例先完成完整结算，再顺序调用 `settleForFact`；ledger 用例删除流水后串行调用两次 append。它们只证明回放/顺序冲突，不是两个 writer 的真实竞争。
- settlement 竞争：使用两个独立 transaction/connection，同时对同一 fact 进入 settlement INSERT；用确定性 barrier 证明两者均已到达首次 INSERT 前的竞争点后再释放。一个 INSERT 成功，另一个在唯一约束上等待/冲突后回放。
- ledger 竞争：使用两个独立 transaction/connection 对同一 settlement 同时进入 ledger INSERT；同样用 barrier 控制，不能用 sleep、概率性时序或单纯 `Promise.all` 冒充。
- 测试 seam 规则：barrier 必须位于待证明 INSERT 紧邻位置，并只在测试显式注入时启用；不得让两个调用共享同一 transaction。
- 精确断言：两个调用均成功并返回相同 settlementId/ledgerEntryId；数据库恰好一 settlement、一 ledger；balance 恰好 +10 且 lastLedgerEntryId 正确；恰好一 `point_ledger.created` audit、一 `points.settled` outbox。分别证明 settlement conflict 与 ledger conflict 两条路径。

### P4-R2-02 — 权威 fact/item 运行时保护测试（P2）

- 为 `loadFactSettlementContext` 至少增加：fact 与 item student 不一致；fact 关联 item 缺失或不可加载（受 FK 限制时可在事务内使用可实现的受控异常 fixture）。若数据库 CHECK 允许构造非法 completion kind，也覆盖该分支；若约束禁止，记录并断言数据库约束已覆盖，不做无意义绕过。
- 每个 service 失败必须精确断言 `STATE_CONFLICT` 或约定的 not-found。
- 失败前后精确比较 settlement、ledger、balance、ledger audit、settlement outbox，证明零部分写入。

### P4-R2-03 — complete 异常回放不补写且状态不变（P2）

- 缺 settlement：记录调用前 event/fact/settlement/ledger/balance/audit/outbox 快照；回放精确 `STATE_CONFLICT`；调用后所有计数和值不变。
- 缺 ledger：保留 settlement，删除 ledger 时不要人为删除或掩盖应检查的 balance；记录异常状态的完整 before 快照，回放后 settlement、ledger、balance、lastLedgerEntryId、audit、outbox 均严格不变，且不得补写 ledger。
- 测试必须证明服务不修复/扩大异常状态，而不仅是抛错。

### P4-R2-04 — 收紧全部单写断言（P2）

- F24 complete 并发：两个调用均 fulfilled，`idempotentReplay === true` 的结果严格恰好一个；返回 event/fact/settlement/ledger IDs 完全相同；对应数据库行与余额/audit/outbox 均严格单写。
- point-rule 同键回放：首次 + replay 后 rule/version 恰好一组，`point_rule.enabled` audit 和 outbox 各恰好一条，resource/aggregate ID 对应首次 rule。
- 不使用 `some()`、`<=1`、`>=` 等弱断言替代精确契约。

## 3. 验证与交接

必须运行：

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

lint 仅允许既有 3 warnings。提交一个聚焦 commit，建议 `test(m2): prove phase 4 conflict invariants`，不得夹带本文件。

固定回报：完整 SHA；修改文件；P4-R2-01～04 对应测试名；两个真实竞争的连接/事务/barrier 时序；全部命令原始结果；未执行项及原因；blocker（无则“无”）。提交后等待 Codex 复审，不得宣称 Phase 4 GO。
