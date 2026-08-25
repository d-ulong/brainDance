# 设计文档索引

本目录保存已确认的产品、领域、架构和交付决策。术语以项目根目录的 [CONTEXT.md](../CONTEXT.md) 为准；需求原文保留在 [originalRequirement.md](../originalRequirement.md)，不作为已确认行为的唯一来源。

## 阅读顺序

1. [产品范围与验收标准](./product-scope.md)：角色、MVP、非范围和验收结果。
2. [关键用户流程](./user-flows.md)：用户操作、授权与状态变化。
3. [数据模型](./data-model.md)：实体、关系、状态机和不可变记录。
4. [架构设计](./architecture.md)：Module、Interface、Seam、安全与响应式策略。
5. [部署方案](./deployment.md)：环境、备份、密钥、监控和发布。
6. [实施路线图](./implementation-roadmap.md)：里程碑、验收、风险和回滚。

## 权威性与一致性

- `CONTEXT.md` 定义术语和用户可见业务规则；`data-model.md` 定义持久化事实源、唯一约束和状态机；`architecture.md` 定义 Module、实时授权和异步交付契约。
- 下游文档只能引用或具体化上游规则，不得以“后文覆盖前文”保留冲突。数值、状态与时间边界变更应先修改权威文档，再同步所有引用。
- 成员、余额、首页和趋势是可重建投影；亲子授权、事实版本、结算、流水和审计是权威记录。

## 决策记录

- [ADR-0001：中国大陆优先部署](./adr/0001-mainland-china-deployment.md)
- [ADR-0002：家庭作为时区与成员归属单位](./adr/0002-family-as-timezone-and-membership-unit.md)
- [ADR-0003：M1 最小可行技术栈](./adr/0003-m1-tech-stack.md)

## 规则

- 已确认术语立即写入 `CONTEXT.md`；该文件不包含实现细节。
- 难以逆转、存在真实取舍的决定写入 `docs/adr/`。
- 设计文档描述已确认行为；未确认问题必须明确标为待确认，不得伪装为事实。
- ADR 必须记录状态、日期、背景、决策、后果、风险/复审触发条件和被替代关系。
