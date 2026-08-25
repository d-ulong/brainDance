# 设计文档修订执行计划

## 修改顺序

1. 更新 `CONTEXT.md`：补充统一时间与资源术语，清除相互冲突或含糊的定义。
2. 更新 `docs/product-scope.md` 和 `docs/user-flows.md`：固定用户可见行为、授权撤销、事实/结算流程与缩小后的纵向路线。
3. 重写 `docs/data-model.md` 的家庭授权、计划事实、积分、训练投影与延后资源段；为关键不变量给出字段和唯一约束。
4. 更新 `docs/architecture.md`：深 Module、实时授权、outbox/Worker、删除/紧急访问和资源治理。
5. 更新 `docs/deployment.md`：容量假设、SLO、故障域、备份恢复、队列运维与对象存储边界。
6. 更新 `docs/implementation-roadmap.md`：纵向里程碑、独立验收、回滚与已决事项。
7. 重写两份 ADR 的完整记录格式，并在 `docs/README.md` 标注权威阅读与决策状态规则。
8. 执行跨文档文本检查，复读关键规则并核对所有引用和术语。

## 验证

- `rg -n "06:00|18:00|authorization_epoch|outbox|settlement|family_memberships" CONTEXT.md docs`
- `rg -n "TODO|TBD|以下.*准|覆盖上文" CONTEXT.md docs`
- 人工核对：产品范围、用户流程、数据模型、架构与路线图对同一规则的用词、数值与状态一致。
- 人工核对：每个核心异步过程都有入队、幂等、重试、死信、监控和恢复说明；每个敏感资源都有事实源、权限判定和审计路径。

## 风险与回滚

- 最大风险是为纠正架构问题而无意改变既定产品规则；修改时保留既有产品约束，所有新增行为仅用于消除歧义或明确实施契约。
- 文档变更可通过版本控制逐文件回滚；不会删除原始需求或实施历史。
