# M2 Cursor 整改清单（唯一执行来源）

> 状态：**NO-GO**。基线：`05abce9`（2026-08-26）。
>
> Cursor 仅按本文件整改；不要根据旧的 `planning-rereview-*.md` 猜测范围，也不要修改 M1 历史任务或启动实现。完成全部 R 项并提交后，交由 Codex 独立复审。

## 不变边界

- 任务保持 `planning`；禁止 `task.py start`、创建 `feat/m2-*` 分支或新增 M2 业务代码/迁移。
- 改动仅限 `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/` 的规划文档与研究记录。
- `docs/data-model.md` 是领域字段命名与可空语义的权威来源。M2 若有缩窄，必须在 `design.md` 和 `implement.md` 明确写为“已批准 M2 范围缩窄”，不得只在对照表中改名。
- 不得重编号既有 C1–C12；以下 R-ID 是本轮稳定整改 ID。

## R1 — plans 当前版本字段统一

**位置**：`docs/data-model.md` §4；`design.md` §4.2、§5.2；`implement.md` §2.0、§2.0.6、§2.0.7。

**问题**：权威字段为 `plans.current_version`，规划迁移使用 `current_version_id`，仅以“→”映射，未形成可实施的统一契约。

**必须修订**：迁移与设计统一使用 `current_version`；其类型为 UUID、FK → `plan_versions.id`、创建 v1 后在同一事务更新。删除 `current_version_id` 的所有引用。若确需保留 `_id` 命名，必须先同步修改 `docs/data-model.md` 并在 task 中写出获批字段重命名决定；本次默认采用权威名 `current_version`。

**验证**：`m2-schema-constraints.test.ts` 断言 `plans.current_version` 存在、`current_version_id` 不存在、FK 正确。

## R2 — plan_versions 的版本唯一性

**位置**：`implement.md` §2.0；`design.md` §4.2；迁移约束测试。

**问题**：只有 `(plan_id, create_idempotency_key)` 唯一，无法阻止同一 plan 出现重复 `version`。

**必须修订**：增加 `UNIQUE(plan_id, version)`；创建写 v1，编辑在锁内写 vN+1。保留命令幂等唯一键，两者不得互相替代。

**验证**：迁移测试插入同一 `plan_id + version` 第二行必须失败；不同 plan 的同 version 可成功。

## R3 — schedule_events 的 skip reason

**位置**：`design.md` §5.4b；`implement.md` §2.0.1；迁移约束测试。

**问题**：skip 命令写入 `reason?`，但 `schedule_events` 表未定义该列。

**必须修订**：新增 `reason text NULL`，仅 skip 可携带；complete 必为 NULL。将其纳入事件复合 CHECK，或在命令/数据库约束中等价保证该语义。

**验证**：测试 skip 可持久化 reason；complete 带非 NULL reason 被拒绝（若采用 DB CHECK）；同键回放不覆盖既有 reason。

## R4 — M2 缩窄范围与空值语义显式化

**位置**：`docs/data-model.md` §4–§5 的 M2 注释或 `design.md` §4.2 的“已批准 M2 范围缩窄”；`implement.md` §2.0.2、§2.0.4、§2.0.7。

**必须作出并记录以下可实施决定**：

1. `fact_versions.schedule_item_id`：M2 仅写 `schedule.completed` 系统事实，因此迁移为 NOT NULL；M3 人工事实/无日程事实恢复可空。这是已批准的 M2 范围缩窄。
2. `point_ledger_entries.settlement_id`：M2 仅写结算来源流水，因此迁移为 NOT NULL；M3 手工奖励/冲销时恢复可空。这是已批准的 M2 范围缩窄。
3. M2 结算流水必须写 `source_type='settlement'` 且 `source_id=settlement_id`；`created_by=NULL` 表示系统写入。`reverses_entry_id=NULL` 是 M2 无冲销的明确约束。
4. 已补的 `confirmed_*`、`supersedes_*`、`voided_at`、`priority`、`reverses_entry_id`、`created_by` 的 NULL 含义也须在对齐表中逐项说明，不得只列字段。

**验证**：迁移测试逐项断言列、FK、NOT NULL/NULL 语义；结算集成测试断言 `source_id=settlement_id`。

## R5 — C8：三条日程生成路径的字段验证

**位置**：`design.md` §5.8A；`implement.md` §4.2、§4.2.2/§4.2.3；`research/m2-verification-matrix.md`；`planning-signoff-checklist.md` C8。

**问题**：算法已写入四个字段，但测试映射只笼统列 `owner_id/slot_key/source`，且 C8 被转移为 horizon/header 测试，未证明三条调用路径均能插入满足 DDL 的 `schedule_items`。

**必须修订**：保留 C8 的 `generateHorizonInline + horizonThrough` 定义，并添加下列精确映射：

| 调用路径 | 测试文件 | 必须断言 |
| --- | --- | --- |
| 创建计划 | `schedule-generation.test.ts` | `student_id=plan.student_id`、`owner_id=plan.owner_id`、`slot_key='default'`、`source='plan'` |
| 编辑计划 | `formal-plan.test.ts` | 同上 |
| 独立 maintain | `maintain-horizon.test.ts` | 同上 |

同时保留 `horizon-through.test.ts` 与 F22 的日期上界断言；它们不能替代上述字段断言。

## 完成标准

1. R1–R5 全部关闭，并在本文件每个标题下补一行“证据：commit + 文档 § + 测试文件”。
2. 更新 `research/m2-verification-matrix.md` 与 `research/planning-signoff-checklist.md`，使 C8 与 S-C4 可追溯到具体测试。
3. 执行：

```powershell
git diff --check
git status --short
```

4. 提交一个聚焦的 docs commit；在 Trellis `m2-planning-rereview` 主题发布 R1–R5 的逐项证据。不得自行宣布 GO。
