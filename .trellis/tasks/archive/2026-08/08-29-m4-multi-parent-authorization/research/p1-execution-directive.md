# M4 P1 Cursor 执行指令：多家长关系与部分撤权基础

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 目标分支：`feat/m4-multi-parent-authorization`
>
> 执行基线：本指令提交的完整 HEAD SHA（先报告 `git rev-parse HEAD`）。
>
> 结论：**只授权 P1；不得开始私密总结 P2。**

## 必读

- `prd.md`、`research/planning-summary.md`、`design.md`、`implement.md`
- `CONTEXT.md` 的授权事实源/授权纪元；`docs/product-scope.md` §3；`docs/data-model.md` §2；`docs/architecture.md` §3。
- `implement.jsonl` 与 `check.jsonl` 的全部条目。

## 允许范围

1. 用 append-only migration 与 Drizzle schema 使 active relationship 的唯一性、同一学生单 active family、membership 查询性能和并发接受可由数据库/事务保证。
2. 改造 relationship accept：学生已有 active family 时，后续 parent 的已接受关系加入该 family；不得因旧的单家庭判断而拒绝第二位 parent。
3. 改造 end relationship：只结束指定 relationship；parent 或 student 仅在其于该 family 已无任何 active relationship 时才离开 membership。保留历史，更新受影响授权 epoch，写 audit/outbox；重复相同请求必须安全 replay。
4. 对既有训练、日程、事实、积分及 profile 的 parent 读取/写入路径保持实时 `requireActiveRelationship` 授权：离关联 parent 对目标 student 立即 403，同时对同 family 其他仍关联 student 仍可访问。
5. 按产品契约停用离关联 parent 为目标 student 创建的未完成正式计划和有效积分规则；若现有兑换模型尚不存在，记录为 P2+ blocker，不得预建完整兑换模块。
6. 添加聚焦迁移、服务、并发、Route 与 M1/M2/M3 回归测试，并更新 P1 implementation record/验收矩阵。

## 明确禁止

- 禁止 Reflection Privacy/每日总结/私密 grant 的业务实现、UI 大改、媒体/评论、通知渠道、M5/M6、依赖升级、历史重写、merge/rebase/reset/push/deploy。
- 禁止把 family_memberships 当作授权真相，或仅依赖前端/异步投影撤权。

## 完成定义与验证

- 覆盖 AC-M4-1、AC-M4-2、AC-M4-3（关系/成员/撤权部分）和 AC-M4-5；P2 的私密总结 AC-M4-4 不得声称完成。
- 在确认隔离且无并发 runner 的数据库上串行执行：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

- 一个聚焦提交；更新 implementation record，列出每个 AC/R-ID 的测试定位、并发时序、迁移/约束名、未执行项。

## 固定回报格式

```text
branch: <branch>
HEAD: <full SHA>
execution_baseline: <full SHA>
resolved_ids: <AC/R-ID>
changed_files: <paths>
database_constraints_and_migrations: <names>
concurrency_evidence: <test + timing>
command_summary: <raw summary>
blockers: <none or details>
status: M4 P1 已交 Codex 审核（非 GO）
```
