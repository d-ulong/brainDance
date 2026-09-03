# 隔离合成恢复与容量演练 Runbook

## 安全前置条件

- 仅可使用新建、可证明隔离的合成 PostgreSQL 数据库；连接字符串不得指向生产或含真实家庭数据的环境。
- 运行前记录执行人角色、目标库别名、代码 SHA、脚本版本和 `BRAIN_DANCE_SYNTHETIC=1`；日志不得记录连接字符串、密钥、正文或媒体链接。
- 任一隔离性无法证明、脚本拒绝执行、迁移失败或 canary 失败时立即停止，结果标为 `blocked`，不得通过删库、篡改 ledger 或重试掩盖。

## 恢复演练

1. 复核 `scripts/recovery-drill.mts` 的 fail-closed 保护与输出路径。
2. 在隔离库执行约定的恢复命令；记录 restore、tombstone/撤权重放、投影重建、canary 和总 RTO 的原始摘要。
3. 验证已删除正文不可读、已撤权资源仍被拒绝、未删除授权矩阵/余额/兑换历史保持一致，且 post-backup marker 未被恢复。
4. 记录 observed RPO/RTO 为合成演练观测值，不得作为生产承诺；失败时保留诊断摘要并建立整改任务。

## 容量与 SLO 演练

1. 复核 `scripts/capacity-synthetic.mts` 的环境拒绝、三档参数和指标输出。
2. 仅执行已授权的档位；M6 已记录 100 家庭档通过，1,000 与 10,000 档仍为 deferred，不能补写为已通过。
3. 记录 families、连接数、队列深度、慢查询可用性、导出/删除吞吐、耗时与资源指标；没有 `pg_stat_statements` 时明确标 `unavailable`。
4. 对照部署 SLO：可用性、5 分钟积分延迟、撤权及时性、RPO/RTO；缺少 staging 监控或告警证据时维持 `blocked`。

## 结果归档

每次演练将脱敏摘要、命令、SHA、目标环境别名、开始/结束时间、结果、失败停止点和复演日期链接到证据台账 LR-05 或 LR-06。禁止保存真实数据、完整备份或连接信息。
