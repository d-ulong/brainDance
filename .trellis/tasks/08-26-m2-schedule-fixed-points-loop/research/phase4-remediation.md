# M2 Phase 4 一次性整改指令 — Settlement / Ledger

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 审核代码基线：`c32b0f72b8b7b4a5caef6c2575b3587af9458c5d`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 结论：NO-GO

## 1. 启动与范围

开始前运行 `git branch --show-current`、`git rev-parse HEAD`、`git status --short --branch`；分支、交接执行基线和干净工作区必须一致，否则停止并回报 blocker。

唯一整改事实来源为本文件 P4-R01～P4-R07；同时遵守 `research/phase4-execution-directive.md` P4-01～P4-03、`design.md` §5.5/§5.6。一次性完成全部项目，不得扩大到 Route/Web/E2E。

允许修改 `src/modules/settlement/**`、最小的 `src/modules/schedule/complete-schedule.service.ts`、`tests/integration/settlement/**`、必要的 Schedule complete/concurrency 测试与 `tests/helpers/**`。禁止修改迁移/schema、API、`.trellis`、无关文件或依赖。

## 2. 阻断项

### P4-R01 — settleForFact 必须从 fact/item 加载权威数据（P1）

- 位置：`src/modules/settlement/settlement.service.ts` 约 62–109 行；complete seam 输入。
- 问题：当前信任调用者传入的 studentId、completionKind、familyDate、idempotencyKey，可将 settlement/ledger 记到错误学生、期间、kind 或 key。
- 修订：`settleForFact` 以 `factVersionId` 为权威锚点，在同一 transaction 内加载 fact 及其 schedule item；student、completion kind、settlement period 和 idempotency key全部由数据库行派生。调用侧只传事实标识及确有必要的非派生上下文。缺失或行间不一致稳定报领域 `STATE_CONFLICT`/not-found，不产生部分写入。
- 验证：聚焦完整性测试证明即使调用参数/外部上下文不一致，也不可能污染 student、period、kind/key；推荐通过收窄类型使错误输入无法表达，并用篡改数据/缺失关联测试验证运行时保护。

### P4-R02 — complete 成功回放必须包含 settlement/ledger（P1）

- 位置：`src/modules/schedule/complete-schedule.service.ts` 的 `loadCompleteReplay` 约 121–130 行。
- 问题：结算或 ledger 缺失时仍返回成功，只给 undefined ID，违反 P4-03/F11。
- 修订：Phase 4 下成功 complete 结果的 settlementId/ledgerEntryId 应为必填；回放找不到任一行时稳定 `STATE_CONFLICT`，不得返回部分成功。首次 complete 也必须原子返回完整链路。
- 验证：构造已有 complete event/fact 但缺 settlement，以及有 settlement 但缺 ledger 的受控异常状态，回放均精确失败且不补写/不改变余额。

### P4-R03 — settlement 冲突分支不得再次尝试 ledger INSERT（P2）

- 位置：`src/modules/settlement/settlement.service.ts` 约 95–109 行。
- 问题：无论 settlement 新建还是冲突回放，当前都调用 `appendLedgerForSettlement`，违背 P4-02“冲突后查询原 settlement/ledger，不重复 INSERT ledger”。
- 修订：仅新插入 settlement 的路径尝试首次 ledger 创建；settlement conflict 路径查询原 settlement 后直接加载并返回其 ledger。若原 ledger 缺失，视为事务/数据不变量破坏并稳定失败，不在回放分支补写。
- 验证：直接命中 settlement conflict，证明不执行 ledger INSERT/balance UPSERT/audit/outbox，返回同一 ledger。

### P4-R04 — 建立真实、确定性的 settlement/ledger 冲突证据（P1）

- 位置：`tests/integration/settlement/settlement-ledger.test.ts` 约 174–204 行。
- 问题：现有并发 complete 的后到者在 schedule-event 层回放，未进入 settlement 或 ledger ON CONFLICT。
- 修订：使用直接 service 调用、独立事务/连接和确定性 barrier（不得 sleep/概率性 Promise.all）分别命中：
  1. settlement 唯一冲突回放；
  2. ledger 唯一冲突/已存在 ledger 路径。
- 验证：最终恰好一 settlement、一 ledger、余额只 +10、单 audit、单 outbox；回放返回相同 IDs。若最小测试 seam 必要，可注入且默认生产行为不变。

### P4-R05 — point-rule audit 幂等 key 必须包含命令 scope（P1）

- 位置：`src/modules/settlement/point-rule.service.ts` 约 220–228 行。
- 问题：`audit:point-rule-enabled:${clientKey}` 在全局唯一 audit key 上丢失 `(parentId,studentId)` scope。不同 student 合法复用同 key 时，第二条规则可能没有对应 audit。
- 修订：audit idempotency key 使用新 ruleId 或包含完整稳定命令 scope，确保每个成功创建的 rule 恰好一条、resourceId 正确的 audit；回放不重复。
- 验证：同 parent 对两个有权 student 复用同一 client key，两个规则各有且仅有一条正确关联 audit/outbox。

### P4-R06 — 补齐 P4-01 规则启用契约测试（P2）

- 位置：`tests/integration/settlement/settlement-ledger.test.ts` 规则测试区。
- 缺口：目前只证明同键回放。
- 验证必须新增：未验证 parent、无 relationship、同 key 异 payload 的精确 `IDEMPOTENCY_CONFLICT`、同 student/template active-rule 冲突，以及 v1 `version=1`、`status=active`、parameters/effect 快照（amount=10、rewardsLateCompletion=true）。同时覆盖 P4-R05 跨 scope 同 key。

### P4-R07 — F24 与 complete 全链路单写证据完整化（P2）

- 位置：`tests/integration/settlement/settlement-ledger.test.ts` 约 346–383 行。
- 问题：测试名称声称单 event/fact/settlement/ledger/audit/outbox，但未查询 schedule event 与 fact。
- 修订：并发 complete 测试精确断言两个调用成功且一个 replay，并按目标 item/fact/resource 范围断言恰好一 event、一 fact、一 settlement、一 ledger、一次余额 +10、一 ledger audit、一 settlement outbox；返回 IDs 完全相同。

## 3. 验证、提交与回报

必须运行：

```bash
pnpm exec vitest run tests/integration/settlement tests/integration/schedule
pnpm exec vitest run tests/unit/time-policy tests/unit/training/time-policy.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <executionBaseline>...HEAD
```

lint 仅允许既有 3 warnings。提交一个聚焦 commit，建议 `fix(m2): remediate phase 4 settlement review`；不得夹带本 `.trellis` 文档。

固定回报：完整 SHA；修改文件；P4-R01～P4-R07 代码/测试证据；权威数据加载和两条冲突时序说明；全部命令原始结果；未执行项及原因；blocker（无则“无”）。提交后等待 Codex 复审，不得宣称 Phase 4 GO。
