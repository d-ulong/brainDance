# 上线准备规划实施记录

## 验收映射

| AC | 交付物 | 结果 |
| --- | --- | --- |
| AC-LR-01 | `launch-readiness-evidence-register.md` | 7 项阻断项均有来源、责任角色、证据、验收角色、初始状态与停止条件。 |
| AC-LR-02 | `synthetic-drill-runbook.md`、台账 LR-05～07 | 将恢复、容量/SLO、紧急访问分为合成可演练与生产前人工审批；列出 fail-closed 停止条件。 |
| AC-LR-03 | `external-review-handoff.md`、台账 LR-01～04 | 明确同意/隐私、DPA、驻留的交接输入与期望输出；未选择供应商，未作结论。 |
| AC-LR-04 | `design.md`、`implement.md` | 后续生产就绪/部署仅能在所有台账项 accepted 后另立任务；本任务未触及生产数据、密钥或供应商账户。 |

## 继承与 Deferred

- M6 已有合成恢复演练与容量 100 家庭档证据；容量 1,000/10,000 档和 `pg_stat_statements` slow-query 指标仍是 deferred/unavailable。
- 法律/合规审阅、供应商选择与 DPA、生产数据驻留核验、真实生产恢复演练和紧急访问组织流程仍为上线 blocker，状态保持 `not-started` 或 `blocked`，不能由本任务关闭。

## 文档验证

- `pnpm exec prettier --check .trellis/tasks/09-03-launch-readiness-blockers`
- `git diff --check`
