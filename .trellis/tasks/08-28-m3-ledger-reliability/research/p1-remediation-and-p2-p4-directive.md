# M3 P1 集中整改与 P2–P4 Cursor 执行指令

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 目标分支：`feat/m3-ledger-reliability`
>
> 固定实现基线：`aa8f6cd`（执行前必须用 `git rev-parse HEAD` 记录完整 SHA）
>
> 审核结论：**P1 NO-GO；本指令只授权关闭全部 P1 整改后，连续完成 P2–P4。**

## 1. 范围与交付边界

本波合并以下交付，不再拆成 P2、P3、P4 三次交接：

1. 先用新的 append-only migration 关闭 P1-R01～P1-R05；不得修改已提交的
   `0014_m3_ledger_reliability.sql`。
2. P2：人工 `error_count` 提交、家长确认、已确认事实更正、规则结算和不可变冲销。
3. P3：outbox 原子领取、租约、重试、dead、尝试审计、管理员查询/重放和脱敏日志。
4. P4：从 `point_ledger_entries` 重建 `point_balance_projection` 的受控 CLI。

本波不做 Web UI、第三方告警、浏览器 E2E、M5+ 能力、合并、推送、部署或 P5 完整质量
签署。提交后只能报告“已交 Codex 审核（非 GO）”。

## 2. 必读文件

1. `prd.md`：M3-D01～D03、M3-R01～R06、AC-M3-1～AC-M3-7；
2. `design.md`：所有章节，尤其 Schema and migration shape、Worker contract、Projection rebuild；
3. `implement.md`：P2～P4、review gates、verification matrix；
4. `research/planning-signoff.md`、`research/p1-execution-directive.md`、
   `research/p1-implementation-record.md` 和本文件；
5. `CONTEXT.md` 术语：已确认事实、事实更正、日程事实更正窗口、负积分余额、规则前瞻生效；
6. `.trellis/spec/backend/` 的 database、error-handling、logging、quality 指南；
7. 现有 `src/modules/schedule/`、`src/modules/settlement/`、`src/modules/outbox/`、
   `src/modules/audit/`、`src/lib/auth-request.ts` 和 M2 API/测试模式。

## 3. P1 集中整改（所有项必须先关闭）

### P1-R01 — 原流水只能被冲销一次（P1 / M3-R03、AC-M3-2、AC-M3-3）

`point_ledger_entries_reversal_idempotency_unique` 当前只限制
`(reverses_entry_id, idempotency_key)`；改变 key 即可为同一原流水写第二条负流水。
改为对非空 `reverses_entry_id` 的唯一约束（一个原 entry 仅一条 reversal）。保留命令幂等
回放行为：冲突必须可由服务回读既有结果，不得再写账。新增真实 PostgreSQL 测试：不同 key、
并发或两事务竞争都只能留下一个 reversal。

### P1-R02 — claim index 必须覆盖租约过期（P1 / M3-R04、AC-M3-5）

Worker 的可领取集合是 `pending AND available_at <= now()` **或** `leased AND leased_until <= now()`。
现有仅按 `available_at` 的 partial index 不能支持第二支。通过新的 migration/schema mirror 建立能支持
两支的索引（可用两个 partial indexes）；测试必须读取实际索引定义或用 `EXPLAIN`/可定位 catalog
证据证明 pending 和 expired-lease 两个 predicate 都有对应索引，而非只检查索引名称。

### P1-R03 — 尝试计数与审计行的最小完整性（P1 / M3-R04）

`outbox_events.attempts` 必须为非负整数。`worker_attempts.attempt_number` 必须为正整数；
`success`/`failure` 必须有 `finished_at`，`leased` 不得有 `finished_at`，`replayed` 必须有
`replay_actor_id` 与非空 `replay_reason`。以新 migration/schema checks 和正反路径数据库测试固化。

### P1-R04 — manual value 负数拒绝证据（P1 / M3-R01）

补足测试 fixture 的 `submitted_by`，使 `error_count = -1` 唯一因
`fact_versions_manual_invariants_check` 的值校验而失败；并覆盖非整数、缺字段和有效 `0`。

### P1-R05 — 旧迁移升级路径（P1 / AC-M3-7）

将 migration 测试扩展为从含 `0014` 的空库/既有库升级到本波新 migration，断言真实 constraint、
index 和 Worker 表存在。不得通过修改 0014、删除 migration history 或只断言 journal 文本解决。

## 4. P2：事实、确认、更正、结算和 API

### 固定 API 契约

- `POST /api/schedule-items/[itemId]/facts/error-count`：已登录学生仅能向自己的正式日程提交
  待确认 `error_count`；body `{ errorCount, assertedAt? }`；要求 `Idempotency-Key`。
- `POST /api/facts/[factId]/confirm`：已验证且 active relationship 的家长确认待确认人工事实；
  要求 `Idempotency-Key`。
- `POST /api/facts/[factId]/correct`：已验证且 active relationship 的家长只能在计划日后 7 个
  家庭自然日内更正已确认、当前可访问学生的人工事实；body 含非负 `errorCount`、非空 `reason`；
  要求 `Idempotency-Key`。管理员只可因 `security` 或 `data_correction` 原因超期处理；管理员路径
  必须显式走 `requireAdminSession`，不得拥有家庭业务的通用代操作权。

所有新 Route 使用 M2 nested error body、Zod 和薄 Route 模式。缺失/空白 `Idempotency-Key` 在
鉴权和领域调用前返回既有 `400 IDEMPOTENCY_KEY_REQUIRED`。未授权、失效关联、学生确认/更正、
错误事实类型、未确认事实、窗口过期和 idempotency payload 冲突必须给出稳定的 401/403/409/400
映射及测试。

### 领域与事务不变量

- 人工事实仅绑定正式 schedule item；service 在事务内锁定权威 item/fact/ledger 行，再作关系、
  角色、正式性、窗口和状态校验。不能信任 body 提供的 student、日期、规则或旧积分。
- 确认在一个事务中追加确认事实状态、settlement/ledger、audit 和 outbox；未确认绝不结算。
- 更正绝不 UPDATE/DELETE 原 fact、settlement、ledger 或规则版本。追加 successor fact；对每个
  原 ledger 追加恰一条以 `reverses_entry_id` 指向原 entry 的负流水；追加 replacement settlement/
  ledger；通过 ledger service 更新 projection；audit/outbox 与上述同一事务。
- 规则快照来自实际被消费的 rule version；规则编辑不重算历史。为首期提供最小
  `schedule_error_count_v1` 模板：当确认 `error_count <= maximumErrorCount` 时按 `amount` 发放；
  只允许通过现有受控 point-rule surface 传入此模板及 Zod 参数，不增加 UI 或自由表达式。
- 所有命令的 replay 及真实并发竞争必须回读既有完整结果，不得重复 fact、settlement、ledger、
  audit 或 outbox。

## 5. P3：可靠 Worker 与管理员运维

- 实现可测试的单次 Worker 入口，使用单事务 `FOR UPDATE SKIP LOCKED` 原子 claim；只领取已到期
  pending 或过期 leased event。完成/失败必须带匹配 lease token，迟到 Worker 不得覆盖新 claim。
- 使用 M3 固定代码常量（在一个邻近模块集中定义）表达最大 attempts、lease 时长和指数退避；
  documented operator surface 显示这些值。不得引入配置框架或第三方队列。
- success → processed；可重试失败 → pending + future `available_at`；耗尽 → dead。每次领取、
  成功、失败、重放产生可查询 `worker_attempts`，且不重复 ledger 副作用。
- 仅明确支持的 M3 事件版本可由 handler 处理；已有 M1/M2 无关的明确支持版本只记录 no-op
  delivery，未知 type/version 必须确定性 retry/dead，绝不静默丢弃。
- 仅在 Worker 入口输出结构化、脱敏日志：event ID/type/version、attempt、错误类别、关联 ID；
  禁止 payload、error_count、账号、token、stack 或原始数据库错误。
- 管理员 API：`GET /api/admin/outbox/dead`（分页/上限）和
  `POST /api/admin/outbox/[eventId]/replay`（body 非空 reason，要求 `Idempotency-Key`）。重放只把
  dead 变回新的 eligible attempt，保留旧 attempts/audit，不改写 event/payload，也不能绕过幂等。

## 6. P4：余额投影重建 CLI

- 新增一个受控 operator CLI，支持无参数全量和 `--student-id <uuid>` 定向重建；拒绝未知、缺值和
  非 UUID 参数，输出只含安全汇总（扫描/重建学生数、ledger 数）。
- 从 immutable `point_ledger_entries` 按稳定总序计算 `sum(amount)` 与最后 entry，并在事务中仅
  replace/upsert `point_balance_projection`。不得调用 settlement、append audit/outbox，或写 ledger。
- 测试全量和单学生、最后 entry、负余额、重复运行，以及无新增 ledger/outbox/audit 的断言。

## 7. 必须提供的测试证据

- P1-R01～R05：真实 PostgreSQL migration/constraint/竞争测试；
- P2：服务集成测试覆盖确认才结算、更正不可变链/恰一 reversal、replay、并发、窗口、角色和
  关系撤销；API integration 覆盖每条写 Route 的 header、DTO、401/403/409 和审计；
- P3：claim、lease expiry、late token、backoff、max attempts/dead、unsupported event、replay、
  no-duplicate-ledger、脱敏日志与 admin API；
- P4：CLI integration 的全量/单学生/负余额/无副作用；
- M2 settlement/ledger 与 transaction outbox 回归。

测试中的“并发”必须由两个独立 transaction/connection 和确定性 barrier 组成；不能用顺序 await
伪造。共享 PostgreSQL 集成套件保持串行。

## 8. 允许改动与禁止项

允许：上述 M3 migration/schema/modules/routes/tests/scripts、`to-route-error-response.ts`、
`m2-schemas.ts`、现有 point-rule surface 与任务 implementation record/verification matrix 的最小改动。

禁止：UI、第三方服务、依赖、M1/M2 无关重构、改写已提交 migration、删除历史、改变测试并行度、
merge/rebase/reset/push/deploy、P5 完整签署或声称 GO。

## 9. 验证、提交与回报

提交一个聚焦的 implementation commit（可含本波所有代码、测试与记录），建议：
`feat(m3): deliver facts worker and projection operations`。

串行执行并逐项报告原始摘要：

```bash
pnpm db:migrate
pnpm test tests/integration/migrations/
pnpm test tests/integration/settlement/settlement-ledger.test.ts
pnpm test tests/integration/outbox/outbox-transaction.test.ts
pnpm test tests/integration/api/
pnpm test tests/integration/facts/ tests/integration/outbox/ tests/integration/settlement/
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

最终回报固定包含：branch、完整 HEAD、完整执行基线、关闭的 P1-R/P2/P3/P4 ID、修改文件、
迁移/constraint/index 身份、Route→测试映射、并发连接/barrier 时序、CLI 无副作用证据、全部命令
原始摘要、未执行项及原因、blocker（无则“无”）。

最后只能写：**“M3 P1 整改与 P2–P4 实现已交 Codex 审核（非 GO）。”**
