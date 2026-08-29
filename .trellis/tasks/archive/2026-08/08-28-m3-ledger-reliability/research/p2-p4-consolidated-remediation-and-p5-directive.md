# M3 P2–P4 集中整改与 P5 Cursor 执行指令

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 审核实现 SHA：`636a026`（执行前必须以 `git rev-parse HEAD` 记录完整 SHA）
>
> 结论：**NO-GO；仅授权关闭本文件全部 R-ID 并完成 P5 验证证据。**

## 1. 固定范围

本次是 M3 的唯一集中整改波：关闭下列全部 R-ID，补齐 P5 验收矩阵、全量串行质量门和
implementation record。不得增加 UI、第三方通知、部署、推送、merge/rebase/reset，或扩展到
M4+。除本文件所列修订动作外，不做 M1/M2 重构。

先读取：`prd.md`、`design.md`、`implement.md`、
`research/p1-remediation-and-p2-p4-directive.md`、
`research/p1-remediation-p2-p4-implementation-record.md`、本文件及
`.trellis/spec/backend/{database-guidelines,error-handling,logging-guidelines,quality-guidelines}.md`。

## 2. 必须关闭的整改项

### M3-R01 — Rule activation must preserve M2 and M3 coexistence (P1 / M3-R03, AC-M3-1, compatibility)

`point_rules_active_student_unique` 和 `loadActivePointRuleForStudent()` 只允许每学生一个 active
rule。启用 `schedule_error_count_v1` 后会阻止/替代 `schedule_system_complete_v1`，而 M3 必须保留
M2 同步完成结算。

新增 append-only migration：将唯一性收窄为“同一学生、同一 template 至多一条 active rule”（或
等价的明确模板维度不变量）。将 rule lookup 改为按 template 选择；M2 `settleForFact` 只加载 system
template，M3 `settleForErrorCountFact` 只加载 error-count template。新增真实集成测试：同一学生启用
两个 template 后，系统完成与确认 error_count 都各自按正确 rule version 结算；任一 template 的
重复 active rule 仍被拒绝。

### M3-R02 — Correction must not rewrite predecessor facts (P1 / M3-R03, AC-M3-2)

`correctFact()` 当前 UPDATE predecessor 的 `voided_at`。这违反 PRD 的“原事实、确认、结算和流水
均只追加”和 design 的不可变历史边界。

不得更新 predecessor。只通过 successor 的 `supersedes_fact_version_id` 表示取代关系；移除该 UPDATE
与把 `voidedAt` 当作更正成功证据的测试。更正后断言 predecessor 每一列（包括 timestamps）保持原值，
successor/settlement/reversal/audit/outbox 全部为新追加行。

### M3-R03 — M3 Worker events require explicit M3 handlers (P1 / M3-R04, AC-M3-5)

当前 Worker 将 `fact.confirmed`、`fact.corrected`、`points.settled` 当作 no-op，并把实际由 submit
产生的 `fact.submitted` 当作 unknown retry/dead。这不符合 design 的 M3 fact-correction /
points-projection handler 要求，也会让正常提交积压 dead-letter。

实现明确版本化的 M3 handler dispatch：至少 `fact.submitted` 为显式支持的安全 delivery，
`fact.confirmed` / `fact.corrected` / `points.settled` 走明确的 M3 handler（可验证的、幂等的 projection
reconciliation 或等价受控动作），不得列为“已有 M1/M2 无关事件”的 no-op。仅 M1/M2 已明确支持的
旧类型可 no-op；未知 type/version 必须 retry/dead。handler 重复调用、lease 到期重领、人工 replay
不得新增 ledger/fact/settlement。补充 handler dispatch、fact.submitted、M3 handler 重复、lease-expiry
真实路径测试。

### M3-R04 — Replay attempt sequence and Idempotency-Key are broken (P1 / M3-R04, M3-R05, AC-M3-5)

`replayDeadOutboxEvent()` 以 `attempts + 1` 写 `replayed`，但没有更新 attempts；下一次 claim 再写
同一 attempt number，命中 `worker_attempts_outbox_attempt_unique`。同时 replay 既不存也不比较
`Idempotency-Key`，而是以 reason 错误回放。

用 append-only migration/schema 使 replay idempotency 可持久验证（例如 worker attempt 的 replay
idempotency key），并把“本轮 retry 计数”和“全局单调 attempt sequence”清晰分离。手工 replay 后下一
次 claim 必须使用新的、不冲突 attempt sequence，且允许完整的新 retry cycle；同 event + same key
回放返回既有结果，不同 key 不得误判回放。使用两个独立连接/事务和 barrier 覆盖 dead→replay→claim、
双 replay 竞争、late lease token；保留所有旧 attempt。每次 replay 写 audit（actor、event、reason、
idempotency key），不记录 payload/PII。

### M3-R05 — Worker transition audit and lease tests are incomplete (P1 / M3-R04, M3-D03)

现有测试只验证 stale token 拒绝与 unknown dead，未验证 lease expiry 的再领取/旧 token 无法完成、
backoff 绝对时间、max-attempt 边界、Worker attempt 状态完整性和管理员 replay audit。补足这些真实
数据库证据。所有 Worker 日志只含允许的字段；不得输出 payload、error_count、身份、token、raw error
或 stack。

### M3-R06 — Admin correction DTO must be one authoritative Zod contract (P2 / M3-R02, M3-R06)

correct Route 先以普通 body schema parse，再从 raw body 手工读取 `adminReason`；已定义的
`adminCorrectFactBodySchema` 未使用，非法 `adminReason` 会落入家长路径。按认证分支选择普通 parent
schema 或 admin schema，并拒绝任何非法 admin reason。覆盖 parent、admin security、admin
data_correction、非法 adminReason、学生、未验证 parent、失效关系、超期 parent 的 Route 证据。

### M3-R07 — Projection rebuild does not define a ledger order and lacks required evidence (P1 / M3-R05, AC-M3-6)

按随机 UUID 排序不能代表“最后流水”，也不能保证 rebuild 后与正常 projection 写入的
`last_ledger_entry_id` 一致。必须建立不可变且可迁移的 ledger ordering source（例如追加式
`created_at` + deterministic tie-breaker；已有行安全 backfill），正常写入与 rebuild 使用同一总序。

全量 rebuild 还必须处理所有 target students 的 projection：不得遗留从权威 ledger 已不存在的陈旧值。
补齐 integration/CLI tests：全量、多学生、定向、负余额、重复执行、最后 entry 精确一致、参数拒绝、
无 audit/outbox/ledger 副作用。CLI 失败输出保持 operator-safe，不泄露原始数据库错误。

### M3-R08 — Missing route/acceptance coverage (P1 / AC-M3-3 through AC-M3-6)

当前 API 测试没有 correct Route 和 replay Route 的成功/失败矩阵，facts 测试只做 confirm 并发，不做
correction 两连接/barrier 竞争，P4 只覆盖两个 service case。补齐每个新写 route 的缺 header、无效 DTO、
401/403/409、success 与 audit/outbox 断言；更正同 key 和不同 key 并发必须证明不重复 fact、settlement、
ledger、audit/outbox。不得用顺序 await 冒充并发。

### M3-R09 — Quality gate is currently red (P1 / AC-M3-7)

独立静态复验：`pnpm typecheck` 与 `pnpm build` 通过；`pnpm lint` 有 13 warnings，其中本波新增 10 条；
`pnpm format` 在 9 个本波文件失败。移除新增 unused imports/variables，格式化本波文件；保留项目既有
3 条 warnings，不得新增告警。

## 3. P5 验收矩阵与验证

更新 M3 implementation record，逐行把 AC-M3-1～AC-M3-7 映射到精确 test/CLI evidence，未覆盖项
必须明确写未覆盖。共享 PostgreSQL 只能在确认目标为测试数据库、且没有并发 runner 后串行运行：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 如与本期无 UI 变化无关仍须执行；若环境不可用，报告原始错误而不是通过。不要擅自
更改 test parallelism 或清理非测试数据库。

## 4. 提交与回报

提交一个聚焦 commit，建议：`fix(m3): close reliability delivery gaps`。回报必须包括 branch、完整
HEAD、完整执行基线、R01～R09 的逐项实现/测试证据、AC-M3-1～7 矩阵、迁移/约束/index 名称、每条真实
并发的连接/transaction/barrier 时序、CLI evidence、所有命令原始摘要、未执行项和 blocker。

最后只能写：**“M3 集中整改与 P5 验证已交 Codex 审核（非 GO）。”**
