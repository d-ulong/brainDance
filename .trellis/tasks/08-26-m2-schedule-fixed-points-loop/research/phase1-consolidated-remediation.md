# M2 阶段 1 全量审核与统一整改清单

> 结论：**GO（Phase 1）**
> 最终签署 HEAD：`fe7c54ffdaf5acacd42854960f6cfcceb1978864`
> 固定基线：`main` @ `d7c6452d25915e25afb4d52d8d12627b7a544941`
> 范围：阶段 1 的全部迁移、Drizzle schema、seed、迁移约束测试及质量门禁
> 本文件取代此前所有阶段 1 审核草稿，是 Cursor 本轮整改的**唯一执行来源**。

## 1. 审核结论

### Standards

1. `0008` 与 `0014` 重复建立 goals/FK，形成两套迁移策略。
2. 所有 SQL 负例只断言“任意异常”，存在系统性假阳性。
3. 必填列未验证 NOT NULL；nullable 契约也未完整执行。
4. schedule event、point rules、ledger 多个用例会先撞非目标约束。
5. projection UPSERT 测试没有进入 `ON CONFLICT DO UPDATE`。
6. 当前测试只在已迁移数据库上运行，不能证明空库和 `main/0007` 升级路径。

### Spec

归并为下方 C-R1～C-R9。除此之外，`0008`–`0013` 的迁移与 Drizzle 在表、列、FK、CHECK、UNIQUE 和 seed 上未发现其他规格漂移。

## 2. 冻结决定

- 阶段 1 最终迁移编号固定为 `0008`–`0013`。
- `goals` 是 `plans.goal_id` FK 的最小前置表，放在 `0008`；M2 不实现 goal 业务。
- 当前分支尚未合并；以 `main/0007 → HEAD` 和空库 `0000 → HEAD` 为权威迁移路径，不兼容曾运行中间提交 `9cb85f0` 的临时本地数据库。
- 测试负例必须证明目标 constraint，而不仅是“SQL 失败了”。

## 3. Consolidated 整改项

### C-R1 — 收敛迁移序列

**文件**：`src/db/migrations/0014_goals_fk.sql`、`src/db/migrations/meta/_journal.json`、`src/db/migrations/0008_plans_and_versions.sql`。

**动作**：删除 `0014_goals_fk.sql` 及 journal 的 0014 条目；保留 0008 中的 goals 最小前置 DDL、users FK 与 `plans.goal_id → goals.id` FK。不得新增其他迁移编号、`IF NOT EXISTS` 或 `duplicate_object` 兜底。

**验证**：空库迁移后 journal 最终 tag 为 `0013_schedule_horizon_maintains`，数据库存在 14 张目标表且 goal FK 正确。

### C-R2 — 精确 SQL 失败断言

**文件**：`tests/integration/migrations/m2-schema-constraints.test.ts`。

**动作**：失败 helper 捕获 PostgreSQL 错误并要求调用方断言 SQLSTATE 与精确 constraint name；NOT NULL 额外断言 column。使用：NOT NULL `23502`、FK `23503`、UNIQUE `23505`、CHECK `23514`。每个负例只能违反目标约束。

### C-R3 — 完整列契约

**规格**：`implement.md` §2.0–§2.0.7、§2.2.1。

**动作**：从 `information_schema.columns` 同时读取列名与 `is_nullable`：

- 对 §2.0–§2.0.7 每张表的所有必填列断言存在且 `is_nullable='NO'`，不得只列业务摘要列；包括所有主体/FK/idempotency/hash/timestamp 列。
- 对 `goal_id`、`source_plan_id`、`current_version`、`description`、`end_date`、`effective_until`、`plan_snapshot`、`schedule_events.completion_kind/reason`、fact confirmed/supersedes/voided、templates negative/limits、rule priority、ledger reverses/created_by、projection last entry 明确断言 `is_nullable='YES'`。
- 保留 `current_version_id` 不存在断言。

### C-R4 — 完整且独立地验证 schedule CHECK

**动作**：分别覆盖并精确命中对应 constraint：

- schedule item 非法 status；
- event 非 `pending` from_status；
- event 非 `completed/skipped` to_status；
- completed + NULL/非法 completion_kind；
- completed + 非 NULL reason；
- skipped + 非 NULL completion_kind。

正例覆盖 completed 的 `on_time`/`late`，以及 skipped 的 reason 为 NULL 和非 NULL。每个负例使用不同 idempotency key。

### C-R5 — 隔离所有 UNIQUE 与 partial predicate

**动作**：

- `plans`：create idempotency 与 active formal partial UNIQUE 做独立行为验证；active formal 另加 inactive formal 与 active 非 formal 不冲突正例，不增加 `plan_kind` DB CHECK。deactivate 索引 `(id, deactivate_idempotency_key)` 因 `id` 已是 PK，不存在可独立制造的冲突行；验收仅要求元数据证明列顺序、UNIQUE 和 `WHERE deactivate_idempotency_key IS NOT NULL` predicate，并验证不同 plan 同 key 可并存。
- `plan_versions`：plan+create key 与 plan+version 分别命中；保留异 plan 同 version 正例。
- `plan_schedule_slots`、schedule event item+key、fact item+key、point rule version、settlement fact+rule+period、horizon student+actor+key、ledger settlement UNIQUE 分别精确验证。
- `point_rules` creator+student+key 使用 `active=false` 隔离；active partial UNIQUE 使用不同 key 的 active rows 单独验证。
- ledger `idempotency_key` 用两个不同 settlement 的同 key 成功插入，证明无全局 UNIQUE；不得只检查索引文本。

### C-R6 — 隔离 ledger NOT NULL、CHECK 与 FK

**动作**：建立至少两个真实、未占用的 settlement fixture，分别验证：

- `settlement_id=NULL` → 23502/column；
- bad source_type + 相同有效 source/settlement → source CHECK；
- 两个不同但有效 settlement ID → source CHECK；
- `source_id` FK 与 source CHECK 的可达行为：由于 CHECK 强制 `source_id=settlement_id`，且 `settlement_id` 自身 FK → settlements，`source_id` FK 不存在能绕过 CHECK/settlement FK 的独立失败输入。验收以元数据精确证明 `source_id → settlements.id`，再用“有效 settlement_id + 不存在 source_id”证明写入被 source CHECK 拒绝；不得声称该行独立命中 source_id FK。
- 不存在 settlement_id + 与其相同 source_id 时，精确命中 settlement_id FK；
- 重复已用 settlement_id → settlement UNIQUE。

成功插入必须显式使用 `reverses_entry_id=NULL`、`created_by=NULL`，证明 nullable 契约。

### C-R7 — 补齐其余 CHECK/FK 的行为证明

**动作**：精确负例覆盖 plans status、fact completion_kind、point rule version status、settlement result；为 `plans.current_version`、goal_id、projection last_ledger_entry_id 保留元数据断言与独立行为负例。`source_id` FK 按 C-R6 的“结构证明 + 可达拒绝行为”验收。不要为规格未要求的固定业务值擅加 CHECK。

### C-R8 — 真正验证 balance UPSERT

**动作**：用同一 student 的两条合法 ledger 依次执行 UPSERT。第一次插入 +10/ledger1；第二次必须走 `ON CONFLICT DO UPDATE`，再累加 +10/ledger2。最终断言 balance=20、last_ledger_entry_id=ledger2，并保留 student PK 与 last-entry FK 元数据断言。

### C-R9 — 两条干净迁移路径与完整门禁

**动作**：使用两个独立临时数据库验证：

1. 空库执行 `0000 → HEAD`；
2. 仅含 main/0007 的数据库执行 `0008 → HEAD`。

两者均检查 journal 最终为 0013、目标表/seed/FK 存在。临时数据库必须使用明确唯一名称并在验证后删除，不得把已记录 0014 的当前本地库作为证据。

然后运行定向测试与完整门禁。

## 4. 非阻断整理

修复上述隔离问题时，可提取一个最小 `seedSettlementGraph` fixture，消除 ledger/balance 重复搭建；不得引入通用 builder 或新的测试框架。

## 5. 禁止项

- 不开始阶段 2 或任何 time-policy、Schedule、Settlement、Route、Web、E2E 业务实现。
- 不修改 M1 历史任务、无关 lint warning或冻结字段名。
- 不扩展 goals 字段和业务逻辑。
- 不把多个约束故意堆在同一失败行上。

## 6. 完成定义与回报

Cursor 必须一次关闭 C-R1～C-R9，提交一个聚焦 commit，并按以下格式回报：

1. 完整 SHA；
2. 修改文件；
3. C-R1～C-R9 逐项证据（测试名/constraint name）；
4. 所有命令及原始结果；
5. 未解决 blocker（无则写“无”）。

必须运行：

```bash
# 两个临时数据库：空库→HEAD、main/0007→HEAD
pnpm exec vitest run tests/integration/migrations/m2-schema-constraints.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check main...HEAD
```

## 7. 当前审核证据

| 检查 | 结果 |
| --- | --- |
| `git diff --check main...a76c97a` | PASS |
| 当前库 `pnpm db:migrate` | PASS，但不能证明干净路径 |
| 独立空库 `0000 → a76c97a` | PASS；14 张目标表；日志显示 0014 对 goals 重复执行 |
| 定向迁移约束测试 | PASS，12 tests；存在系统性假阳性 |
| 全量测试 | PASS，13 files / 65 tests |
| typecheck / format | PASS |
| lint | PASS，0 errors；3 个既有 warning |

## 8. `a911d20` 剩余整改（最终复验范围）

> C-R1、C-R8、C-R9 已 PASS；C-R2～C-R7 只需关闭下列三个实际缺口。除下列项目外，不得重写已通过测试。

### F-R1 — 测试不得修改被测 schema

**问题**：`m2-schema-constraints.test.ts` 的 `beforeAll` 在迁移后 DROP/ADD completion CHECK，并把生产约束 `schedule_events_to_status_check` 重命名为测试专用名称；`afterAll` 未恢复。这使测试验证的是人造 schema，并污染共享测试库。

**动作**：

1. 删除全部测试内 `ALTER TABLE ... DROP/ADD/RENAME CONSTRAINT` 语句及相关 cleanup 状态。
2. 对真实迁移产物做元数据断言：`schedule_events_from_status_check`、`schedule_events_to_status_check`、`schedule_events_completion_reason_check` 均存在，定义分别包含冻结语义。
3. from_status 可继续精确命中 from constraint。
4. 非法 to_status 会同时违反 to-status 与 composite CHECK，PostgreSQL 可按内部顺序报告任一项；断言 SQLSTATE=`23514` 且 constraint 属于这两个真实名称之一，不得改名控制执行顺序。
5. completion/reason 的其他可独立输入继续精确命中 `schedule_events_completion_reason_check`。

### F-R2 — 补齐完整列映射

**动作**：在 required/nullability mapping 中加入：

- `goals`：`id, student_id, creator_id, title, status, start_date` 为 NOT NULL；`due_date, closed_at` 为 nullable。
- `schedule_horizon_maintains`：`id, student_id, actor_id, idempotency_key, idempotency_payload_hash, items_created, created_at` 全部 NOT NULL。

继续通过 `information_schema.columns.is_nullable` 验证，不新增业务 CHECK。

### F-R3 — 补 `schedule_items.occurrence_key` UNIQUE 行为

**动作**：先插入合法 schedule item，再用不同主键/其他合法字段但相同 `occurrence_key` 插入第二行，精确断言 SQLSTATE=`23505` 和 `schedule_items_occurrence_key_unique`。不得与 status/FK/NOT NULL 冲突。

### 最终复验

Cursor 仅修改 `tests/integration/migrations/m2-schema-constraints.test.ts`；除非删除测试污染所必需，不再修改迁移或 Drizzle schema。提交一个聚焦 commit并回报 F-R1～F-R3 证据，以及 §6 的全部命令结果。

## 9. `f21e2a9` 最终审核追加整改

> 规格轴已 PASS：F-R1～F-R3 均关闭，提交范围也符合要求。工程规范轴仍有下列唯一阻断项，因此阶段 1 维持 NO-GO。此项关闭后只做复验，不重新打开已通过项。

### F-R4 — 临时数据库生命周期必须失败安全

**文件**：`tests/integration/migrations/m2-schema-constraints.test.ts`，`openIsolatedM2Database` / `closeIsolatedM2Database`。

**问题**：

1. `CREATE DATABASE` 成功后，如果迁移或业务 client 初始化失败，`openIsolatedM2Database` 不会返回，调用方的 `isolatedDb` 仍为 `undefined`，`afterAll` 无法清理；临时数据库和 admin 连接会泄漏。
2. `closeIsolatedM2Database` 采用顺序 await 且没有失败兜底。`client.end`、terminate、DROP 任一步失败都会跳过后续清理，尤其可能跳过 `admin.end`。

**动作**：

1. 创建阶段在数据库创建成功后进入失败回滚保护；迁移或 client/db 初始化失败时，必须尽最大努力终止目标库连接、删除临时库并关闭 admin，然后重新抛出原始初始化错误。
2. 关闭阶段必须保证始终尝试关闭业务 client、终止目标库连接、删除临时库和关闭 admin；使用清晰的 `try/finally` 或等价的最小实现，不能因前一步失败跳过后续资源释放。
3. 不引入新依赖或通用资源管理框架；可提取一个仅供本测试文件使用的最小清理 helper，避免创建失败与正常关闭路径重复。
4. 保留 F-R1～F-R3 的现有断言语义，不修改迁移、Drizzle schema 或业务代码。

**验证**：

- 增加聚焦测试或可控失败注入，至少证明“创建后迁移失败”仍会尝试 DROP 与关闭 admin，以及“关闭中间步骤失败”不会跳过后续 DROP/admin.end。测试不得依赖残留数据库的人工检查。
- 运行 §6 的全部命令。

**完成定义**：F-R4 的失败路径有自动化证据；成功路径 12 项迁移约束测试继续通过；工作区不存在本次测试产生的残留临时数据库。Cursor 提交单一聚焦 commit，并按 §6 固定格式回报。

## 10. Phase 1 最终签署

**签署基线**：`fe7c54ffdaf5acacd42854960f6cfcceb1978864`
**结论**：GO；Phase 1 迁移、Drizzle schema、seed、约束测试及临时数据库测试基础设施在本基线范围内通过。下一阶段为 implement §1 的 Phase 2（扩展 `src/modules/time-policy/`）。

### 双轴审核

- Standards：PASS，0 个发现。F-R4 使用最小测试 helper 复用初始化回滚与正常关闭逻辑，每个释放步骤独立保护；未发现显著代码坏味道。
- Spec：PASS，0 个发现。C-R1～C-R9、F-R1～F-R4 均关闭；F-R1～F-R3 未回退；无迁移、schema、业务代码或依赖范围扩张。

### 最终验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/integration/migrations/m2-isolated-database-lifecycle.test.ts tests/integration/migrations/m2-schema-constraints.test.ts` | PASS，2 files / 15 tests |
| `pnpm test` | PASS，14 files / 68 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors；3 个既有 warnings |
| `pnpm format` | PASS |
| `pnpm build` | PASS |
| `git diff --check f21e2a9...fe7c54f` | PASS |

### 签署边界

- GO 仅适用于上述固定 SHA 和 Phase 1 范围。
- `.trellis` 签署文档必须先形成独立文档提交；该提交 SHA 才是 Phase 2 的固定基线。
- Phase 2 不得夹带 Schedule、Settlement、Route、Web 或 E2E 实现。
