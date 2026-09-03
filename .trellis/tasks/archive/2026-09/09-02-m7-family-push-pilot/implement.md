# M7 家庭推送试点实施计划

## 固定信息

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 规划基线：`3513cd1a94206335162a3805548068a6942f52d3`
- 建议分支：`feat/m7-family-push-pilot`
- 分工：Codex 冻结指令并审核固定 SHA；Cursor 只实现当前唯一阶段指令。

## P1：文本/链接、预约、作答与评论闭环

1. 先写 migration/schema 约束和授权矩阵测试，建立 push/version、answer/version、comment/version 权威表。
2. 实现创建者所有权、版本化编辑、立即/预约发布、停用/删除及关系结束时取消 scheduled。
3. 接入既有 outbox Worker，保证重试/dead replay 只发布和通知一次。
4. 实现学生版本化文本作答、家长评论/学生回复、自有评论编辑删除及无正文审计。
5. 增加薄 Route、DTO 与文本/原始 URL UI；覆盖 desktop/mobile 主路径及越权/冲突/冻结。
6. 写 `research/p1-implementation-record.md`，映射 R-M7-01～04、07～08 与 AC-M7-01～04、07～08。

P1 验证：migration、family-content、family-access、freeze、outbox、audit、notification、API、聚焦 E2E、typecheck、lint、format、build。

## P2：受控图片与删除/恢复闭环

1. 建立 `PrivateMediaStore` seam、media objects/references/purge intents 与数据库约束。
2. 实现 10MB 限制、magic bytes/解码校验、扫描接口、重编码、staging 隔离和 ready promote。
3. 实现资源绑定短时读取能力和实时授权；离关联、冻结、删除后立即拒绝。
4. 实现 90 天无引用清理、失败重放、账户删除/tombstone/恢复防复现。
5. 增加恶意/伪装/超限/重编码失败测试及双视口图片推送与作答 E2E。
6. 写 `research/p2-implementation-record.md`，映射 R-M7-05～06 与 AC-M7-05～06，并汇总 AC-M7-09。

P2 验证：migration、媒体安全、删除/恢复、全量 test、typecheck、lint、format、build、完整双视口 E2E。

### P2 终局复验与架构返工

- P2 提交 `db0e9dbb96af4483a61ff8ff5017f635741c1f08` 终局复验为 NO-GO，原 P2 补丁轮次冻结，禁止合入 `main`。
- 唯一恢复路径为 `research/p2-architecture-rework-directive.md`：重建 purge 不确定性、未发布 migration gate、测试 seam 与不可空跑证据。
- 架构返工只审核一次；若仍有 P1 阻断项，则终止 M7 媒体范围并回退至 P1 可交付边界，不继续追加整改轮次。
- 架构返工提交 `4b0421c0b925f4a6253f5bf86a3f99edbc1a0975` 终审 NO-GO；已触发终止条件。唯一后续为 `research/p2-scope-rollback-directive.md`，完成后 M7 交付范围收敛至已签署 P1。
- 用户随后撤销范围回退决定；`p2-scope-rollback-directive.md` 作废且不得执行。P2 保留，唯一后续改为 `research/p2-seal-correction-directive.md` 的三个封板缺口；完成后直接进入里程碑门禁。

## 审核与回滚点

- 每个阶段只允许一个聚焦业务提交；Cursor 只能声明“已交审核”。
- Codex 按固定 SHA 审核；NO-GO 一次性冻结全部阻断项，单阶段最多实现审核、集中整改、最终复验三轮。
- P1 不得提前实现图片、供应商 SDK 或生产媒体配置；P2 不得重写 P1 权威状态机。
- 禁止 merge/rebase/reset/force-push、部署、生产数据/媒体和关闭上线 blocker。
