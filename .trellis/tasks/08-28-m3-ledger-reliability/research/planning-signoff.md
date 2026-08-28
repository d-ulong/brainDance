# M3 规划签署

| 项 | 值 |
| --- | --- |
| 审阅 SHA | `9d0a4953f97e1fb7c24dd05cce0280b9638e58c3` |
| 日期 | 2026-08-29 |
| 结论 | **GO（规划层）** |
| 批准来源 | 项目负责人明确指令：“批准 M3 规划并启动 P1” |
| 审阅者 | Codex |

## 签署结论

M3 的 `prd.md`、`design.md`、`implement.md`、`implement.jsonl` 与
`check.jsonl` 已齐备；M3-D01～D03 已冻结，M3-R01～R06 与
AC-M3-1～AC-M3-7 可追溯到五个独立阶段及验证矩阵。规划阻塞项为零，允许
Trellis 任务从 `planning` 进入 `in_progress`。

## 放行边界

- 目标分支固定为 `feat/m3-ledger-reliability`；规划基线固定为
  `9d0a4953f97e1fb7c24dd05cce0280b9638e58c3`，其父级实施基线为
  `main` / `d78a0a9c2a16a77e9f1ca94cb9a9c6e7836101a8`。
- 本 GO 只批准 `implement.md` 的 **P1 — schema and module contracts**。
- P2～P5 未获授权；P1 提交后状态只能是“已交 Codex 审核”，必须等待固定
  SHA 审核与新的 GO。
- 本签署不授权合并、推送、部署、rebase、强推或修改 `main`。

## 规划审阅摘要

- 领域边界：人工事实、更正链、结算/账本、后台投递和投影重建所有权明确。
- 数据完整性：追加式事实、唯一冲销、命令幂等、Worker 租约令牌与尝试审计均
  有数据库约束或阶段测试要求。
- 兼容性：M2 同步结算和历史流水不被重写；迁移采用 expand → deploy →
  contract。
- 运维安全：dead 查询、人工重放、脱敏日志和 ledger-only 重建边界已冻结。
- 交付可验证性：每阶段有独立范围、命令、审核门和回滚点。

