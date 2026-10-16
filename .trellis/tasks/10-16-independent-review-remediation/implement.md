# 实施与验证

1. 固定用户决策和基线，保留原有脏文件；恢复 frozen-lockfile 依赖。
2. 按 design.md 分工并行实现；共享接口通过消息确认，migration 元账本主会话统一核对。
3. 主会话更新 UI/client、CI和产品文档，接通执行更正与资格能力 DTO。
4. 先纯单元、typecheck、受影响 ESLint 与 diff；数据库核心并发使用显式 braindance_review_test_20261016 隔离库串行测试与 migration，不连接试点库。
5. 跨模块高风险变更扩大到相关模块集成测试及日程/身份双视口聚焦浏览器验证；不机械重复全量测试或 build。
6. 独立检查代理做固定 diff 复核并自修本次问题；补需求矩阵、实施记录、spec、lessons.md/memo.md。
7. 报告实际验证结果和需要外部配置项目，不以代码完成替代生产联调。不部署、不重置数据或密钥。
