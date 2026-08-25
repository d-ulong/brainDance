# 设计文档修订设计

## 修订原则

以“一个事实一个权威来源”为原则，按 `CONTEXT.md → 产品范围 → 用户流程 → 数据模型 → 架构 → 部署 → 路线图 → ADR` 的方向收敛。下游文档只能引用或具体化上游规则，不能覆盖其数值或状态语义。

## 权威资源模型

### 家庭与授权

- `relationships` 是亲子协作授权的权威事实，包含 parent、student、family、状态、创建与结束信息。
- `family_memberships` 是由有效关系推导的成员归属投影；若持久化，必须在同一事务维护，并满足“活跃成员当且仅当至少存在一条同家庭的活跃关系”。
- 敏感读取实时依据关系事实与逐资源授权判定；授权投影仅服务列表与性能，不能独立放行。
- 解除关系在一个事务内结束关系、撤销私密授权、使会话/授权 epoch 失效、产生 outbox 事件与审计。媒体短时链接不得超过撤权 SLO。

### 日程、事实与积分

- `plans` 的每个可执行版本含稳定的 `schedule_slot_key`；实例的唯一身份是 `(plan_id, plan_version, family_date, schedule_slot_key)`。
- `schedule_events` 仅记录状态迁移。可结算事实统一为版本化 `facts`：系统记录、人工声称、确认、作废和更正均通过不可变事实版本表达。
- 结算链为 `confirmed_fact_version → settlement → ledger_entries → balance_projection`。`settlements` 使用 `(fact_version_id, rule_version_id, settlement_period)` 唯一约束；冲销流水通过 `reverses_entry_id` 链接原流水。
- 家庭时区下的计划时间、实际发生、提交、确认和业务日期分字段保存。补填奖励截止固定为计划日次日 `18:00`；迟完成窗口和事实更正窗口独立定义。

### 训练与投影

- 每日有效资格使用稳定 `training_key`，而不是 definition UUID；唯一约束为 `(student_id, training_key, family_date)`。
- 训练会话保留 definition version 与 age band 快照；档案投影键包含 student、training key、definition version、age band 与 metric key。

## 可靠异步处理

所有异步动作通过 PostgreSQL transactional outbox：领域事务同时写事实和 outbox；Worker 使用租约领取、幂等处理、指数重试、死信和事件版本。日程滚动生成、18:00 负向结算、通知、导出、删除和投影重建均使用此机制。文档将定义事件唯一键、最大重试、报警与人工重放界面要求。

## Module 与安全资源

架构文档新增 Family Access、Schedule & Facts、Settlement & Ledger、Reflection Privacy、Redemption、Data Lifecycle、Audit & Emergency Access 等 Module。每个 Module 仅暴露命令/查询 Interface；调用方不能直接改余额、投影、授权记录或底层表。

删除以 deletion request、冻结、撤销期、确认/强制执行和 tombstone 建模。恢复备份后先应用 tombstone，避免已删除内容复现。紧急访问通过双人批准、短时且精确范围的 capability 实现；每次读取都关联批准单并审计。

## 路线图与运行资源

M1–M6 重排为纵向切片：基础身份与单家庭闭环、计划与固定积分、账本与异步可靠性、多家长与授权、训练扩展与趋势、私密总结/兑换/删除导出。部署文档增加 100/1,000/10,000 活跃家庭容量假设、SLO、队列延迟、撤权时效、单/多可用区取舍、恢复演练及对象存储引入时机。ADR 统一补足状态、背景、后果、风险与复审条件。

## 兼容与回滚

本任务尚未存在代码或数据库，因此只需保证文档内术语和行为一致。后续实现采用 expand → deploy → contract；任何旧投影均可从不可变事实、结算和流水重建，规则与训练定义只新增版本。
