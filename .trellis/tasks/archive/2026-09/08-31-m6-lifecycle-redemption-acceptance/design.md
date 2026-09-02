# M6 技术设计

## 1. 边界与原则

M6 在现有模块化单体中增加 `Redemption` 与 `Data Lifecycle` 两个深模块，复用 `Settlement & Ledger`、`Family Access`、`Reflection Privacy`、`Audit` 与 `Background Delivery` 的既有接口。Route 保持薄层，业务写入经 service 事务完成；跨模块不直接写对方投影或权威表。

学生整账户删除不是数据库级级联删除。系统先冻结账户相关授权和命令，再由 Worker 按版本化清除计划逐模块处理，最后写 tombstone。不可变流水和无正文安全审计保留完整性所需字段，但解除与已删除学生的可识别关联。

## 2. P1 兑换模型

新增 `redemption_catalog_items` 与 `point_redemptions`，以数据库 check/unique 约束表达状态、正成本、幂等键和单申请唯一扣减。目录项由创建家长独占编辑；读取和审批均实时验证 active relationship。

申请时锁定目录项并快照成本与月限次语义。批准时按稳定顺序锁定申请、学生余额投影和相关月度申请集合；在一个事务内校验 pending、当前授权、非负且足额余额、月限次，然后写 approved、唯一负向 ledger entry、余额投影、审计与 outbox。取消、拒绝和批准终态互斥；重复相同 idempotency payload 重放结果，不同 payload 冲突。

离关联处理扩展既有 creator-config deactivation，只停用该家长创建的 active 目录项并取消仍 pending 的相关申请，不更改历史终态。

## 3. P2 导出模型与私有 artifact

新增 `export_jobs`，保存 requester、版本化 `scope_snapshot`、状态、artifact key、下载令牌哈希、过期与消费时间。创建任务时先实时解析学生本人或家长当前授权范围；snapshot 记录资源类型、学生 ID、授权纪元和私密 grant 版本，不保存正文。

Worker 执行前再次检查账户/资源冻结与授权纪元，按 snapshot 读取允许数据，生成版本化 JSON artifact。学生导出本人允许数据；家长只导出 snapshot 中当前仍可读的数据，任何撤权、冻结或删除优先于旧 snapshot。这样“创建时快照”固定上限，但不允许之后已撤销的权限通过旧任务继续泄露。

定义最小 `PrivateArtifactStore` seam：put、open-once、revoke、purge。测试使用受控临时目录 adapter；生产 provider 留给独立 ADR。数据库只保存 opaque key 和 token hash，不保存下载令牌、私有链接或 artifact 正文。下载事务原子消费令牌；过期、已消费、撤权或冻结统一拒绝。

## 4. P2 删除、冻结与 tombstone

新增 `deletion_requests`、`deletion_tombstones` 及版本化 target/scope。target 至少支持独立每日总结和 student account。请求事务写 frozen 状态、审计/outbox，并通过 Data Lifecycle 的统一 guard 让所有相关读取与命令在服务端拒绝。

学生账户冻结 guard 必须接入身份会话、关系授权、训练、日程/事实、结算/兑换、总结、导出与首页查询；冻结后撤销现有学生会话和私有下载。30 天撤销恢复业务入口但不自动恢复离关联配置或已独立撤销授权。最终执行须学生确认；管理员强制执行必须通过明确的受控 service 参数记录原因，不能成为普通 Route 的替代身份。

清除 Worker 使用固定模块顺序和每步完成标记：撤销 session/artifact → 停止未来日程与配置 → 清除总结/训练答案等正文 → 最小化身份字段与可识别引用 → 清理可重建投影 → 写/确认 tombstone → 标记 executed。每步以 `(deletion_request_id, step_version)` 幂等，重试不重复副作用。

账本金额、冲销关系、审计 action/reason/time 和数据库完整性键可保留；显示名、登录标识、总结正文、训练答案/事件中可识别 payload、导出 artifact 等必须清除或去标识。具体字段矩阵在 P2 实施记录中逐表列出并由测试固定。

## 5. 恢复与重建

提供只接受合成/隔离数据库的恢复演练脚本：恢复备份副本后，先载入 tombstone 与授权撤销事实，再执行清除重放，最后重建余额、成员、训练和其他投影。脚本必须拒绝未显式标记的生产连接。

恢复验证以 canary 数据证明：已删除正文不可查询、旧 session/token/artifact 不可使用、未删除家庭数据与不可变账本一致、投影重建结果等于恢复前允许状态。记录实际 RPO/RTO、数据库/队列规模和失败点，不把目标值写成保证。

## 6. UI 与 API

P3 增加学生兑换入口、家长目录/审批入口、学生与家长导出状态、删除请求/撤销/学生确认界面。危险操作使用明确对象、影响范围与撤销期说明；不使用模糊“清空”文案。所有写 Route 要求 `Idempotency-Key`，错误映射保持无权与不存在不泄露。

desktop Chromium 与 360×800 走相同主路径；状态不只靠颜色，下载/删除/审批按钮具有 loading、终态和失败反馈。UI 不持有授权事实，只展示服务端 DTO。

## 7. 兼容、回滚与风险

- 迁移遵循 expand → deploy → contract；M1–M5 历史保持可读，冻结 guard 和队列可通过功能开关关闭新请求。
- 兑换回滚停止目录/申请写入；已批准负向流水不删除，必要时用明确反向流水修正。
- 导出/删除回滚停止 Worker 领取并撤销未消费 artifact；不得回滚 tombstone 或恢复已清除正文。
- 最大风险是漏接冻结入口和漏清除字段。P2 必须维护跨模块 Route/service/表字段矩阵，测试矩阵缺项即不得进入 P3。
- 供应商、DPA、数据驻留、生产密钥、真实生产备份和法律期限仍是上线 blocker，不因本地演练通过而关闭。

## 8. 验证映射

P1 覆盖 AC-M6-01～02；P2 覆盖 AC-M6-03～06；P3 覆盖 AC-M6-07～10。每阶段在固定提交 SHA 上审核；Codex NO-GO 时一次性形成稳定 R-ID 整改文档，Cursor 不从聊天猜测问题。
