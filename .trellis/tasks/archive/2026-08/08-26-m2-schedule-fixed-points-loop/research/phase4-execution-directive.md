# M2 Phase 4 Cursor 执行指令 — Settlement +10 / late

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 已签署 Phase 3 代码基线：`9916c7d93a241986d56f9791ee5dd432f59fb910`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 阶段：implement §1 Phase 4
> 状态：批准执行

## 1. 启动门禁与必读来源

开始前运行 `git branch --show-current`、`git rev-parse HEAD`、`git status --short --branch`。分支、执行基线和干净工作区必须与交接通知一致；记录 `executionBaseline`，否则停止并回报 blocker。

唯一必读：

1. `AGENTS.md` §§2–5；
2. `prd.md`：D1、AC-M2-4/5、F4/F11/F15/F17/F24/F25；
3. `design.md` §4.4、§5.0、§5.5、§5.6、§6；
4. `implement.md` §1 Phase 4、§2.0.3–§2.0.4、§3 settlement 布局、§4.2 `settlement-ledger.test.ts`、C9/R4；
5. `research/phase3-signoff.md` 与 `research/planning-signoff-checklist.md` 的 Settlement/Ledger 条目。

实现前使用 `rg` 检查现有 points schema、audit/outbox 写法、Schedule complete seam 与测试 fixture；复用既有事务和 schema，不新增迁移或依赖。

## 2. 允许范围

- `src/modules/settlement/**`
- 为接入既有 seam 所需的最小 `src/modules/schedule/complete-schedule.service.ts` 修改
- `tests/integration/settlement/**`
- 必要且聚焦的 Schedule complete/concurrency/outbox 测试更新
- 测试确有需要时最小修改 `tests/helpers/**`

## 3. 实现契约

### P4-01 启用规则

- 实现 `point-rule.service.ts`，只支持 `schedule_system_complete_v1`；创建 active rule/version 时执行 actor/student/relationship 授权与命令幂等。
- 同 scope/key/hash 回放；异 hash 稳定 `IDEMPOTENCY_CONFLICT`。同 student/template 的 active rule 契约遵循既有唯一约束。
- 模板与 version 快照必须使 on_time、late 均奖励 +10；不得加入未要求的规则编辑、停用、管理 UI 或通用规则引擎。

### P4-02 settleForFact 同步事务

- `settleForFact` 必须接收 Phase 3 complete 的同一 transaction，并在 fact 创建后同步执行；禁止跨事务、异步队列或事后补账。
- 加载 active point rule/template；读取 fact 与 schedule item 的 `completion_kind`/family_date。on_time 与窗口内 late 均为 +10；窗口外 complete 不会进入。
- settlement 唯一 scope：`(fact_version_id, rule_version_id, settlement_period)`；冲突时查询并回放原 settlement，不重复 ledger。
- ledger：`amount=10`、`reason='schedule_complete'`、`source_type='settlement'`、`source_id=settlement_id`、`settlement_id` 非空、`idempotency_key=fact.idempotency_key`、explanation 含 `completion_kind`、`created_by/reverses_entry_id=NULL`。
- ledger `ON CONFLICT (settlement_id) DO NOTHING RETURNING`；只有 RETURNING 新 ledger 时才 UPSERT balance，使用 `balance = point_balance_projection.balance + EXCLUDED.balance` 并更新 `last_ledger_entry_id`。回放绝不再次累加。
- 写 `point_ledger.created` audit 与对应 outbox，且只随首次 ledger 写入一次。

### P4-03 complete/skip 与回放

- complete 首次返回 event + fact + settlement + ledger；同 key 回放必须包含同一 settlement/ledger，余额不变。
- complete×complete 并发仍只允许一个 event/fact/settlement/ledger 与一次余额 +10；后到者成功回放。
- 已 completed 后异 key仍为状态冲突且无新 ledger。不同 schedule item 可复用同一客户端 key，并分别产生 settlement/ledger。
- skip 不调用 settlement，不写 ledger/balance；窗口外 complete 无 ledger。

## 4. 禁止项

- 不新增/修改 API Route、Web、E2E 或迁移/schema 契约。
- 不实现手工奖励、冲销、规则编辑/停用、ledger 删除/更新或余额直写路径。
- 不回改已签署 Schedule 授权、幂等、horizon 与终态顺序；仅做同事务 seam 接入及返回值扩展。
- 不修改 `.trellis` 文档、M1 历史任务或无关文件，不新增依赖。

## 5. 必须测试与完成定义

创建 `tests/integration/settlement/settlement-ledger.test.ts`，至少证明：

- on_time +10、late +10，explanation 含 completion_kind；
- 首次 ledger 后 balance 0→10，`last_ledger_entry_id` 正确；
- complete 同键回放返回同 ledger，balance 保持 10；
- settlement/ledger 并发或冲突路径不重复累加；
- 两个 item 复用客户端 key，各自一条 ledger；
- `source_id=settlement_id` 正路径；
- skip、窗口外 complete、completed 后异 key均无新 ledger；
- complete 并发单 event/fact/settlement/ledger/audit/outbox。

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

lint 只允许既有 3 个 warning。提交一个聚焦 commit，建议 `feat(m2): implement settlement and ledger`；不得夹带 `.trellis`。

固定回报：完整 SHA；修改文件；P4-01～P4-03 实现证据；AC/F/C9/R4→测试名映射；同事务 seam 签名与调用顺序；全部命令原始结果；未执行项及原因；blocker（无则“无”）。不得宣称 Phase 4 GO，提交后等待 Codex 审核。
