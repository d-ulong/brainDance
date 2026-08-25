# BrainDance

家庭学习、计划与认知训练产品的设计仓库。首期服务 5–18 岁学生及其家长，以训练、正式计划和可追溯积分结算形成家庭协作闭环；不提供医学、智力或心理诊断。

## 从这里开始

- [领域术语与业务规则](./CONTEXT.md)
- [设计文档索引](./docs/README.md)
- [产品范围与验收标准](./docs/product-scope.md)
- [架构设计](./docs/architecture.md)
- [数据模型](./docs/data-model.md)
- [实施路线图](./docs/implementation-roadmap.md)

## 当前范围

首个可用闭环是：一位已验证家长、一名已关联学生、反应力训练、单时间点正式计划与固定积分模板。多家长授权、训练扩展、私密总结、兑换、导出和删除按路线图逐步交付。

所有项目术语以 `CONTEXT.md` 为准；持久化事实源、唯一约束和状态机以 `docs/data-model.md` 为准。详情见 [设计文档索引](./docs/README.md)。

## 仓库约定

- `.trellis/` 保存项目工作流、规范和任务记录。
- 本机 Codex 与共享代理运行配置位于用户级目录，不纳入仓库；`.agents/` 和 `.codex/` 已由 `.gitignore` 忽略。
- 环境文件、依赖缓存和日志不纳入版本控制。
