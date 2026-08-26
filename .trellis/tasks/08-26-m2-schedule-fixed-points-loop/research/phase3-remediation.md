# M2 Phase 3 一次性整改指令 — Schedule Domain

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 审核代码基线：`ead7fd7e225396fbe774e0da5fad2c38a4ff8be6`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 审核结论：NO-GO
> 阶段：Phase 3 remediation

## 1. 启动门禁

开始前运行：

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
```

分支必须等于目标分支，HEAD 必须等于 Codex 交接通知中的执行基线且包含本文件，工作区必须干净。记录 `executionBaseline=$(git rev-parse HEAD)`。任一条件不满足即停止并回报 blocker。

唯一整改事实来源为本文件的 P3-R01～P3-R06；同时遵守 `AGENTS.md`、`design.md` §5.0/§5.2/§5.3/§5.8B 和 `research/phase3-execution-directive.md` P3-05/P3-06/P3-08/P3-09。不得扩展 Phase 3 范围。

## 2. 一次性阻断项

### P3-R01 — edit/deactivate 回放前缺少 owner 授权（P1）

- 位置：`src/modules/schedule/plan.service.ts` 的 edit 约 347–379 行、deactivate 约 542–566 行。
- 原因：当前只确认 actor 是 verified parent，便按 plan/key/hash 返回历史结果；未先证明 `plan.ownerId === input.ownerId`。知道 plan ID、key 和 payload 的其他家长可读取回放结果。
- 修订：任何成功回放或幂等冲突判定之前，先以无副作用读取完成 plan owner 授权；未授权稳定返回 forbidden，且不得泄露回放存在性或结果。事务内仍须重新加载/锁定真实 plan，避免把预读当并发正确性保证。
- 验证：edit、deactivate 各增加“另一 verified parent 使用已存在 key 与相同 payload”测试，断言 forbidden、无写入、无回放数据泄露。

### P3-R02 — edit/deactivate 并发同 key 不会稳定回放（P1）

- 位置：`src/modules/schedule/plan.service.ts` 的 edit 锁定路径约 381 行起、deactivate 锁定路径约 568 行起。
- 原因：仅在加锁前检查回放；取得 `FOR UPDATE` 后没有重新检查。相同请求竞争时，edit 后到者可能撞唯一约束，deactivate 后到者可能得到 `STATE_CONFLICT`。
- 修订：完成授权后保留快速回放；取得相关锁后、任何状态检查或副作用前，再查询同 scope/key 并按 actor/hash/action 判定回放或 `IDEMPOTENCY_CONFLICT`。不得依赖捕获原始唯一约束作为正常控制流。
- 验证：edit×edit、deactivate×deactivate 真实并发测试均须证明两个调用成功、后到者为回放、仅一组版本/状态变更/audit/outbox；同 key 异 payload 必须稳定 `IDEMPOTENCY_CONFLICT`。

### P3-R03 — persist expired 可覆盖并发 completed/skipped（P1）

- 位置：`src/modules/schedule/persist-expired.service.ts` 约 16–37 行。
- 原因：先 SELECT pending IDs，随后 UPDATE 仅按 ID；SELECT 与 UPDATE 之间若 complete/skip 提交，过期更新会把终态覆盖为 expired。
- 修订：UPDATE 自身必须再次限定目标 student、`status='pending'` 以及本次选中的合格 ID（保留既有 completion-window 语义）；只允许 pending→expired，绝不覆盖其他终态。不要把前置 SELECT 当作写入条件。
- 验证：增加可重复的真实竞争回归，证明与 complete 及 skip 竞争时最终 completed/skipped 不被 expired 覆盖；同时验证其他 student 和非 pending 行不被更新。

### P3-R04 — maintain 生成与并发契约测试为空验证（P1）

- 位置：`tests/integration/schedule/maintain-horizon.test.ts` 约 37、136、182 行。
- 原因：create 已填满 horizon 后立即 maintain，没有制造缺口；`after >= before` 与 outbox `<= 1` 在零生成、零 outbox 时也通过，未证明 P3-08。
- 修订：用受控数据库状态制造当前 version 的真实 horizon 缺口，再调用 maintain；并发用例也必须在调用前确认存在缺口。保留生产实现契约，不通过弱化断言解决。
- 验证：断言准确新增数及 occurrence、maintain row 的准确 `items_created`、首次生成恰好一条 audit 和一条 outbox；同 scope/key 并发两个调用均成功且一个为回放，只存在一条 maintain row、一次生成和恰好一组 audit/outbox。另保留 no-op 与 replay-no-side-effect 的独立覆盖。

### P3-R05 — complete/skip 未按契约在锁与回放判定前授权（P1）

- 位置：`src/modules/schedule/complete-schedule.service.ts` 约 131–154 行；`src/modules/schedule/skip-schedule.service.ts` 约 123–145 行。
- 原因：当前先锁 item 并检查既有 event，再验证 actor/student/relationship；未授权调用者可因已用 key 得到 idempotency conflict，违反 design §5.0 与 P3-09 的“授权先行”，并泄露命令状态。
- 修订：事务前或事务开头用只读 item 信息完成 actor/student/relationship 授权；授权通过后才进入锁定、重新加载和锁后幂等顺序。锁后仍以重新加载的数据执行状态/窗口/写入判断。
- 验证：complete、skip 各增加未授权 actor 针对已使用 key（相同及冲突 payload）的测试，均稳定 forbidden 且无副作用/信息泄露。

### P3-R06 — terminal 并发测试未锁定稳定错误码（P2）

- 位置：`tests/integration/schedule/schedule-terminal-concurrency.test.ts` 约 124–153 行。
- 原因：当前只断言一 fulfilled/一 rejected；错误即便是 `STATE_CONFLICT` 也会通过，不能证明 complete×skip 的跨动作幂等冲突契约。
- 修订：对 rejected 分支断言领域错误的稳定 code 精确等于 `IDEMPOTENCY_CONFLICT`，同时保留单终态 event/fact 与无重复副作用断言。
- 验证：多次运行该测试仍稳定通过，不以消息文本或数据库原始错误作为断言。

## 3. 允许范围与禁止项

允许修改：

- `src/modules/schedule/plan.service.ts`
- `src/modules/schedule/persist-expired.service.ts`
- `src/modules/schedule/complete-schedule.service.ts`
- `src/modules/schedule/skip-schedule.service.ts`
- `tests/integration/schedule/**`
- 若测试 fixture 确有需要，可最小修改 `tests/helpers/**`

禁止修改：API Route、迁移/schema 契约、Settlement/积分/ledger/balance、M1 历史任务、任何 `.trellis` 文档、无关代码、依赖与格式化噪声。不得新建抽象层来处理仅本轮六项即可直接修复的问题。

## 4. 完成定义与验证

P3-R01～P3-R06 必须全部完成并在回报中逐项给出代码与测试证据。必须运行：

```bash
pnpm exec vitest run tests/unit/schedule tests/integration/schedule
pnpm exec vitest run tests/integration/schedule/maintain-horizon.test.ts tests/integration/schedule/schedule-terminal-concurrency.test.ts tests/integration/schedule/schedule-auth.test.ts tests/integration/schedule/command-idempotency.test.ts
pnpm exec vitest run tests/unit/time-policy tests/unit/training/time-policy.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <executionBaseline>...HEAD
```

lint 仅允许基线已有 3 个 warning，不得新增 warning/error。若命令受环境影响未执行或失败，不得宣称通过，必须原样回报。

提交一个聚焦 commit，建议 `fix(m2): remediate phase 3 schedule review`；不得修改或夹带本 `.trellis` 文件。

固定回报格式：

1. 完整 SHA；
2. 修改文件；
3. P3-R01～P3-R06 → 修订位置与测试名；
4. 每条验证命令及原始结果；
5. 未执行项及原因；
6. 未解决 blocker，无则写“无”。

Cursor 不得宣称 Phase 3 GO；提交后等待 Codex 复审。
