# M3 最终整改 Cursor 执行指令

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 审核实现 SHA：`3df4791`（执行前必须用 `git rev-parse HEAD` 报告完整 SHA）
>
> 结论：**NO-GO；只授权关闭 F-R01～F-R04。**

## F-R01 — 管理员成功更正 Route 不得返回 500（P1 / M3-R02、M3-R06、AC-M3-4）

`p2-p4-consolidated-implementation-record.md` 已明确记录
`POST /api/facts/[factId]/correct` 的管理员成功路径在 Vitest 返回 500。service 层覆盖不能替代
Route/API acceptance。

定位并修复根因，不得以跳过测试或把 500 当环境问题关闭。补足真实 Route integration：带有效 admin
session、`adminReason=security` 与 `adminReason=data_correction` 均返回 200；超期 parent 409、学生/
未验证 parent/失效关系 403、缺 header 400、非法 DTO/adminReason 400。成功路径必须确认 successor、
reversal、audit 与 outbox 均存在。

## F-R02 — Projection last-entry 在并发 ledger 写入下必须保持总序（P1 / AC-M3-2、AC-M3-6）

`upsertBalanceFromLedgerEntry()` 在读取 current projection 与 UPSERT 之间没有按 student 串行化；两个
并发事务都可能读到旧 projection，后提交的较早 ledger 可将 `last_ledger_entry_id` 倒退。

在同一事务中对 student 的权威行或等价 per-student row lock 进行串行化，再读取/更新 projection；保持
`(created_at,id)` 总序，余额累加不丢失。用两个独立 DB connection/transaction + barrier 测试乱序
createdAt 的并发写入：最终 balance 正确、last entry 恰为总序最后项；再从 ledger rebuild 并断言完全一致。

## F-R03 — Worker eligibility 必须使用同一可注入时钟（P1 / M3-R04、AC-M3-5）

`claimNextOutboxEvent()` 的 SQL predicate 使用 PostgreSQL `now()`，但 lease/backoff 使用 input.now；现有
lease-expiry 测试的 2026-01 时间实际上依赖真实数据库时钟，不能证明被测的 expiry 分支。

将 pending eligibility 和 expired-lease eligibility 绑定到同一个 `input.now`（生产未传时才使用当前时间）。
补真实测试：设置 `leased_until` 恰好在 input.now 前/后，前者可 claim、后者不可 claim；并保留 stale token
拒绝和 claim index 的 catalog/EXPLAIN 证据。不要改变生产的 UTC 语义或引入测试专用分支。

## F-R04 — 最终证据与质量门（P1 / AC-M3-4、AC-M3-7）

更新 implementation record：删除“管理员 Route 500”未覆盖项，逐项映射 AC-M3-1～AC-M3-7 到精确 test
及命令结果。此前数据库集成测试仅有 Cursor 报告，Codex 未复跑（审核环境无法确认 database 是否隔离）。
本次必须在确认 `DATABASE_URL` 指向隔离测试库、且没有并发 runner 后串行运行并报告原始摘要：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

如果无法确认隔离测试库，停止在运行数据库测试之前，报告 URL 的安全识别信息（不得泄露凭据）和 blocker；
不得跳过或声称通过。

## 边界、提交与回报

只允许修改实现 F-R01～F-R04 所必需的 Route、Worker、projection/ledger、测试、任务记录及必要的
append-only migration/schema。禁止 UI、依赖、无关重构、历史重写、merge/rebase/reset/push/deploy。

提交一个聚焦 commit，建议 `fix(m3): close final reliability gaps`。固定回报：branch、完整 HEAD、完整
执行基线、F-R01～F-R04 的代码/测试证据、并发的两连接+barrier 时序、migration/index（如有）、
AC-M3-1～7 矩阵、所有命令原始摘要、未执行项和 blocker。

最后只能写：**“M3 最终整改已交 Codex 审核（非 GO）。”**
