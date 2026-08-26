# M2 规划复审 — `9c87d40`

**范围**：`42f25ea...9c87d40`，仅审阅 `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/`；未启动任务，未实施。

## 结论

**NO-GO（修订后再审）**。`9c87d40` 已闭合此前关于 D4/D5、创建回放优先、payload hash、`fact_versions.idempotency_key`、skip API、复用 `time-policy`、迟完成窗口与双端 E2E 的问题；但以下阻断项尚未闭合。

## 必须修订

1. **恢复规划文档自包含性。** `prd.md` 以“同前”“…”替代 AC-M2-1/2/5/6/8 的验收细节；`implement.md` 以“同前”替代 M1 衔接、检查清单和明确禁止项。恢复完整正文；不可要求实现者回查旧提交。

2. **统一日程事件幂等 scope。** 当前 `schedule_events` UNIQUE 为 `(schedule_item_id, idempotency_key)`，但文本又将 actor 视为 scope 一部分；skip 可由学生或关联家长执行。二选一并写入 schema、回放语义及测试：
   - actor 纳入唯一 scope；或
   - 这是资源级 scope，跨 actor 使用同 key 一律 409，绝不回放另一操作者的结果。

3. **修复编辑后版本的 horizon 生成。** 编辑会先取消旧版本 future items；若维护从“所有已有 future 最大日期”起算，则取消项仍可能把起点推进到 horizon 尾端，造成新版本没有实例。维护必须按当前有效版本计算，或从 `effective_from` 生成至 `today + 30`。

4. **skip 也必须处理完成窗口。** 窗口外、持久化状态仍是 pending 时，skip 不可直接转换为 skipped。采用与 complete 一致的语义：事务内 `pending -> expired` 后返回 409；同步补充测试。

5. **固定 completion_kind 的存储和校验。** `on_time | late` 决定结算 explanation 与 +10 行为，不能标为“可选字段或 metadata”。固定其在 event 的受校验 metadata（并在 fact 快照）或固定字段中的位置，保留真实 `occurred_at`。

6. **明确内联维护与独立维护命令的事务边界。** 创建/编辑内联调用维护时，是否写 `schedule_horizon_maintains`、audit/outbox、使用何种幂等键必须明确。创建回放不可再次维护或额外发事件。

7. **维护命令必须由显式用户操作触发。** 不要在页面 mount 自动 POST `maintain-horizon`；这会让查看页产生 audit/outbox 写入。改为“补齐日程/刷新”按钮。固定 D3 为 30 天，删除无实际配置价值的 `horizonDays?: 30` 参数。

8. **清理格式错误。** `git diff --check 42f25ea...9c87d40` 报告 `implement.md:100` 尾随空格；修订后必须通过。

## 放行条件

- 仅修改上述 M2 任务目录的规划文档和验收矩阵；不执行 `task.py start`，不创建实现分支，不写迁移、API 或业务代码。
- 执行 `git diff --check` 并为每个阻断项补足可追溯的 AC / 集成测试要求。
- 提交规划修订后，将提交 SHA 和逐项对应位置回复到 Trellis 主题 `m2-planning-rereview`。
