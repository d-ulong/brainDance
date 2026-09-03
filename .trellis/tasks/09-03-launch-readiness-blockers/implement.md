# 上线前阻断项规划执行方案

## P1：证据台账与边界冻结

1. 汇总 `docs/implementation-roadmap.md`、`docs/deployment.md`、`CONTEXT.md`、`docs/architecture.md` 的权威约束。
2. 为五类门槛建立台账模板：来源、责任角色、证据、审核人、状态、过期/复审日期和停止条件。
3. 将“不得以代码/本地测试替代外部审查”写入每一项验收。

## P2：合成演练设计复核

1. 审核 `scripts/recovery-drill.mts` 的隔离保护、tombstone/revocation-first 顺序与 canary 输出。
2. 审核 `scripts/capacity-synthetic.mts` 的隔离保护、100/1k/10k 分档、可用/不可用指标标注与结果记录格式。
3. 形成演练 runbook：输入、执行人、预期工件、失败停止条件、结果归档位置；不运行生产或真实数据演练。

## P3：组织交接与放行审阅

1. 编制同意/隐私、DPA/驻留、紧急访问的最小交接清单与问题模板。
2. 记录责任角色和审批链，不虚构具体个人、供应商能力或法律结论。
3. 形成最终 GO/NO-GO 门禁与后续独立任务拆分建议。

## Verification

- 文档交叉核对：术语与边界不超出 `CONTEXT.md`、路线图、架构和部署文档。
- 脚本只做静态/接口审阅；若后续任务获授权运行，必须仅指向合成隔离数据库，并保留原始结果。
- `pnpm format` 与 `git diff --check` 用于本任务文档变更。

## Explicit Stop Conditions

- 出现生产数据库、真实备份、真实用户数据、密钥、供应商账户、DPA 签署或法律结论需求时停止并请求相应授权。
- 发现现有恢复/容量脚本无法证明目标隔离性时，不运行脚本；先另立安全整改任务。
