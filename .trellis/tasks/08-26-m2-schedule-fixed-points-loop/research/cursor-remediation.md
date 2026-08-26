# M2 Cursor 整改清单（唯一执行来源）

> 状态：**NO-GO**。复审基线：`18c0961...f57d15e`（2026-08-26）。
>
> Cursor 仅按本文件整改；不要根据旧的 `planning-rereview-*.md` 猜测范围，也不要修改 M1 历史任务或启动实现。完成全部 R 项并提交后，交由 Codex 独立复审。

## 不变边界

- 任务保持 `planning`；禁止 `task.py start`、创建 `feat/m2-*` 分支或新增 M2 业务代码/迁移。
- 改动仅限 `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/` 的规划文档与研究记录。
- `docs/data-model.md` 是领域字段命名与可空语义的权威来源。M2 若有缩窄，必须在 `design.md` 和 `implement.md` 明确写为“已批准 M2 范围缩窄”，不得只在对照表中改名。
- 不得重编号既有 C1–C12；以下 R-ID 是本轮稳定整改 ID。

## R1 — plans 当前版本字段统一

**位置**：`docs/data-model.md` §4；`design.md` §4.2、§5.1、§5.2；`implement.md` §2.0、§2.0.6、§2.0.7。

**问题**：权威字段为 `plans.current_version`，规划迁移使用 `current_version_id`，仅以“→”映射，未形成可实施的统一契约。

**必须修订**：迁移与设计统一使用 `current_version`；其类型为 UUID、FK → `plan_versions.id`、创建 v1 后在同一事务更新。删除 `current_version_id` 的所有引用。若确需保留 `_id` 命名，必须先同步修改 `docs/data-model.md` 并在 task 中写出获批字段重命名决定；本次默认采用权威名 `current_version`。

**验证**：`m2-schema-constraints.test.ts` 断言 `plans.current_version` 存在、`current_version_id` 不存在、FK 正确。

**证据**：`06a2aaf` + `design.md` §4.2/§5.1/§5.2 + `implement.md` §2.0/§2.0.6/§2.0.7 + `m2-schema-constraints.test.ts`

## R2 — plan_versions 的版本唯一性

**位置**：`implement.md` §2.0；`design.md` §4.2；迁移约束测试。

**问题**：只有 `(plan_id, create_idempotency_key)` 唯一，无法阻止同一 plan 出现重复 `version`。

**必须修订**：增加 `UNIQUE(plan_id, version)`；创建写 v1，编辑在锁内写 vN+1。保留命令幂等唯一键，两者不得互相替代。

**验证**：迁移测试插入同一 `plan_id + version` 第二行必须失败；不同 plan 的同 version 可成功。

**证据**：`06a2aaf` + `implement.md` §2.0 + `design.md` §4.2 + `m2-schema-constraints.test.ts`

## R3 — schedule_events 的 skip reason

**位置**：`design.md` §5.4b；`implement.md` §2.0.1；迁移约束测试。

**问题**：skip 命令写入 `reason?`，但 `schedule_events` 表未定义该列。

**必须修订**：新增 `reason text NULL`，仅 skip 可携带；complete 必须为 NULL。将其纳入事件复合 CHECK，或在命令/数据库约束中等价保证该语义。

**验证**：测试 skip 可持久化 reason；complete 带非 NULL reason 被拒绝（若采用 DB CHECK）；同键回放不覆盖既有 reason。

**证据**：`06a2aaf` + `design.md` §5.4b + `implement.md` §2.0.1 + `m2-schema-constraints.test.ts` + `schedule-skip.test.ts`

## R4 — M2 缩窄范围与空值语义显式化

**位置**：`docs/data-model.md` §4–§5 的 M2 注释或 `design.md` §4.2 的“已批准 M2 范围缩窄”；`implement.md` §2.0.2、§2.0.4、§2.0.7。

**必须作出并记录以下可实施决定**：

1. `fact_versions.schedule_item_id`：M2 仅写 `schedule.completed` 系统事实，因此迁移为 NOT NULL；M3 人工事实/无日程事实恢复可空。这是已批准的 M2 范围缩窄。
2. `point_ledger_entries.settlement_id`：M2 仅写结算来源流水，因此迁移为 NOT NULL；M3 手工奖励/冲销时恢复可空。这是已批准的 M2 范围缩窄。
3. M2 结算流水必须写 `source_type='settlement'` 且 `source_id=settlement_id`；`created_by=NULL` 表示系统写入。`reverses_entry_id=NULL` 是 M2 无冲销的明确约束。
4. 已补的 `confirmed_*`、`supersedes_*`、`voided_at`、`priority`、`reverses_entry_id`、`created_by` 的 NULL 含义也须在对照表中逐项说明，不得只列字段。

**必须修订（DDL 可执行）**：在 M2 ledger 迁移中增加 **CHECK** `source_type='settlement' AND source_id=settlement_id`；`source_id` **FK → settlements.id**（与 `settlement_id` 同指 settlement 行）。

**验证**：迁移测试断言 CHECK 与 FK；负路径（错误 `source_type`、不匹配 `source_id`、无效 settlement FK）插入失败；M2 可空列接受 NULL；`settlement-ledger.test.ts` 断言正确结算流水成功。

**证据**：`d139440` + `design.md` §4.2/§5.5 + `implement.md` §2.0.4/§2.0.7 + `m2-schema-constraints.test.ts` + `settlement-ledger.test.ts`

## R5 — C8：三条日程生成路径的字段验证

**位置**：`design.md` §5.8A；`implement.md` §4.2.4；`research/m2-verification-matrix.md`；`planning-signoff-checklist.md` C8。

**问题**：算法已写入四个字段，但测试映射只笼统列 `owner_id/slot_key/source`，且 C8 被转移为 horizon/header 测试，未证明三条调用路径均能插入满足 DDL 的 `schedule_items`。

**必须修订**：保留 C8 的 `generateHorizonInline + horizonThrough` 定义，并添加下列精确映射：

| 调用路径 | 测试文件 | 必须断言 |
| --- | --- | --- |
| 创建计划 | `schedule-generation.test.ts` | `student_id=plan.student_id`、`owner_id=plan.owner_id`、`slot_key='default'`、`source='plan'` |
| 编辑计划 | `formal-plan.test.ts` | 同上 |
| 独立 maintain | `maintain-horizon.test.ts` | 同上 |

同时保留 `horizon-through.test.ts` 与 F22 的日期上界断言；它们不能替代上述字段断言。

**证据**：`d139440` + `design.md` §5.8A + `implement.md` §4.2.4 + `planning-signoff-checklist.md` C8 + 三路径集成测试

## R6 — C8：生成器必须使用 version slot 快照时间

**位置**：`design.md` §5.8A 步骤 0；`implement.md` §3/§4.2.4；`planning-signoff-checklist.md` C8。

**问题**：`generateHorizonInline(plan, version, from, through, ...)` 使用未定义来源的 `localTime` 来构造 occurrence key 与 scheduled_at。创建、编辑和 maintain 因而无法证明使用的是传入 `version` 的 `plan_schedule_slots` 快照，违反每 version slot 快照语义。

**必须修订**：helper **步骤 0** 按 `plan_version_id=version.id AND slot_key='default'` 查询唯一 slot，以其 `local_time` 生成；maintain 将 `plans.current_version` 解析为 version 对象后传入 helper。不得读取 `plans.current_version` 替代传入 version，也不得使用隐式/全局 localTime。

**验证**：创建、编辑、maintain 三类测试均断言 `scheduled_at` 与 `occurrence_key` 使用该 `version` 的 slot `local_time`；编辑改时间后使用新版本时间。

**证据**：`d139440` + `design.md` §5.8A + `implement.md` §4.2.4 + `schedule-generation.test.ts` / `formal-plan.test.ts` / `maintain-horizon.test.ts`

## R7 — C2/C12：编辑时必须先读取旧 slot，再切换当前版本

**位置**：`design.md` §5.2；`implement.md` §4.2.4；`research/m2-verification-matrix.md`；`planning-signoff-checklist.md` C2/C12。

**问题**：现流程先执行 `UPDATE plans SET current_version=vN+1.id`，随后在未传 `localTime` 时从 `plans.current_version` 查询应复制的旧 slot。此时它已指向新 version，而新 slot 尚未插入，导致 localTime 无来源并破坏 F27。

**必须修订**：在同一事务中固定以下顺序：

1. 锁定 plan，保存 `oldVersionId = plans.current_version`；
2. body 未传 `localTime` 时，按 `oldVersionId + slot_key='default'` 读取并锁定旧 `local_time`；
3. INSERT vN+1；INSERT vN+1 的 default slot（未改时间复制旧值，改时间使用 body 值）；
4. 最后 `UPDATE plans SET current_version=vN+1.id`；
5. 以 vN+1 调用 horizon 生成。

**验证**：`formal-plan.test.ts` 覆盖“编辑未传 localTime”成功，新 slot、`occurrence_key`、`scheduled_at` 均使用旧 slot 时间；仍保留“编辑改时间”使用新 slot 的断言。

**证据**：`9e62abf` + `design.md` §5.2 + `implement.md` §4.2.4 + `formal-plan.test.ts`

## R8 — 整改证据必须填写实际提交 SHA

**位置**：本文件 R1–R7 的“证据”行。

**问题**：现有证据写为“（见本提交 SHA）”或 amend 前 SHA（如 `1919079`），不满足本文件要求的“证据：commit + 文档 § + 测试文件”。

**必须修订**：将每一项替换为实际 commit SHA（R1–R6 对应已提交修订，R7 对应 `9e62abf`，R8 对应本证据修订提交），并保留文档 § 与测试文件；不得保留占位文本。

**证据**：`677d74a` + 本文件 R1–R7 各证据行

## R9 — F22：编辑后的 endDate 必须作为取消与 horizon 的唯一输入

**位置**：`design.md` §5.2；`implement.md` §4.2；`research/m2-verification-matrix.md`；F22 映射。

> 注意：`planning-signoff-checklist.md` 的 C6 是 `settlement_period = family_date`，不是 endDate 门禁；R9 仅使用稳定 ID 与 F22，禁止再称“C6 endDate”。

**问题**：编辑流程写入 `plans.end_date` 后，后续仍以未说明是否已刷新的 `plans.end_date` 传给 `cancelPendingAfterEndDate()` 和 `horizonThrough()`。缩短 endDate 时，取消与新实例生成可能使用旧日期。复审还发现 `updatedPlan` 使用数据库字段 `end_date`，而 `horizonThrough` 当前读取 `plan.endDate`，会使有效结束日被忽略。

**必须修订**：在锁定 plan 后明确计算 `effectiveEndDate`，并构造 `updatedPlan`：

```text
effectiveEndDate = body.endDate ?? oldPlan.end_date
UPDATE plans SET end_date = effectiveEndDate, ...
updatedPlan = oldPlan with end_date=effectiveEndDate and current_version=vN+1.id
cancelPendingAfterEndDate(student_id, effectiveEndDate)
through = horizonThrough(updatedPlan)
generateHorizonInline(updatedPlan, version=vN+1, from, through, ...)
```

不得依赖 ORM/SQL UPDATE 后内存对象是否自动刷新。并统一 `horizonThrough` 的输入契约为数据库领域对象：`{ end_date?: string | null }`，函数内部只读取 `plan.end_date`；创建、编辑、maintain 均传该领域对象。不得让 `updatedPlan.end_date` 与 `horizonThrough(plan.endDate)` 混用。

**验证**：F22 的 `plan-end-date.test.ts` 与 `formal-plan.test.ts` 均断言编辑缩短 endDate 后：future pending 在新结束日后被取消、任何新/保留 pending 实例均不超过新结束日；编辑扩展或未改 endDate 时使用相应有效值。`horizon-through.test.ts` 断言 `end_date` 低于 30 天 cap 时返回该日期，NULL 时返回 cap。

**复审结论（未关闭）**：`1fa8376` 已关闭 stale-object 问题，但未统一 `end_date` / `endDate`，故不能作为 R9 的最终证据。

## R10 — B3/G2：命令算法不得含不可实施省略符

**位置**：`design.md` §5.1、§5.2、§5.6；`planning-signoff-checklist.md` B3；`PLANNING-REVIEW.md` G2。

**问题**：已有门禁禁止 `…`、`等同理` 等不可实施占位，但三段命令算法仍使用它们，实施者无法确定实际 INSERT/UPDATE 字段与来源。

**必须修订**：

1. §5.1 创建计划：明确 plans 的 owner/student/title/description/start/end/idempotency 字段、v1 与 slot 的写入来源；
2. §5.2 编辑计划：明确 title/description/endDate 的保留与更新语义（并采用 R9 的 `updatedPlan`）；
3. §5.6 启规则：明确 point_rule 的 student/creator/template/active/idempotency/hash，以及 v1 的版本/参数/effect/effective_at 写入来源。

不得用 `...`、`…`、`同前`、`等同理` 代替命令契约。

**验证**：对上述算法区执行静态检查，`rg '(\.\.\.|…|同前|等同理)' design.md` 在 §5.1/§5.2/§5.6 命令块内不得命中；并保留每个命令对应的测试映射。

**证据**：`1fa8376` + `design.md` §5.1/§5.2/§5.6 + `implement.md` §4.2.5 + `schedule-generation.test.ts` / `formal-plan.test.ts` / `command-idempotency.test.ts`

## 完成标准

1. R1–R10 全部关闭，并在本文件每个标题下补一行“证据：commit + 文档 § + 测试文件”。
2. 更新 `research/m2-verification-matrix.md` 与 `research/planning-signoff-checklist.md`，使 C8 与 S-C4 可追溯到具体测试。
3. 执行：

```powershell
git diff --check
git status --short
```

4. 提交一个聚焦的 docs commit；在 Trellis `m2-planning-rereview` 主题发布 R1–R10 的逐项证据。不得自行宣布 GO。
