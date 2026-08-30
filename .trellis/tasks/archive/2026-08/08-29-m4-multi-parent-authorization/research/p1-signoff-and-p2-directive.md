# M4 P1 签署与 P2 Cursor 执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> P1 固定实现 SHA：`354f95040ee50278f558d4ca9756da405bd43f82`
>
> 结论：**P1 GO；授权只执行 P2 私密总结与逐家长授权闭环。**

## P1 签署范围

- 多家长/多学生复用同一家庭、同一学生单 active family、部分解除后的 membership 聚合、授权 epoch 刷新与创建者配置停用已覆盖。
- 并发接受、并发关系结束、旧会话 401 与刷新会话的 target 403/remaining 200、audit/outbox 唯一性与 P1 worker noop 均有定位测试。
- Cursor 在隔离 Docker PostgreSQL 串行记录：`pnpm db:migrate`、`pnpm test`（48 files / 348 tests）、`pnpm typecheck`、`pnpm lint`（3 条既有 warning）、`pnpm format`、`pnpm build`、`pnpm test:e2e`（12 passed）通过；Codex 独立复核实现及静态门。
- 不包含 Reflection Privacy、私密 grant、每日总结 UI/Route；这些由 P2 承担。

## P2 固定基线与必读

- 目标分支：`feat/m4-multi-parent-authorization`
- 执行基线：本指令提交的完整 HEAD（先报告 `git rev-parse HEAD`）。
- 必读：`prd.md`、`research/planning-summary.md`、`design.md`、`implement.md`、本文件、`CONTEXT.md` 授权事实源/授权纪元、`docs/product-scope.md` 每日总结与私密范围、`docs/data-model.md` §2、`docs/architecture.md` §3/§6，以及 `implement.jsonl`/`check.jsonl`。

## P2 前置清理

当前工作区有 Cursor 生成且未跟踪的 `test-output.txt`。在实施前确认其为此次测试输出后删除它；不得提交或保留该产物。随后 `git status --short --branch` 必须干净。

## P2 允许范围

1. 用 append-only migration 与 Drizzle schema 新增仅文本的每日总结和 `private_access_grants`；每学生/家庭日期至多一条总结，grant 对 `(resource_type, resource_id, parent_id)` 可审计、可撤销且不重复有效。
2. 新建 Reflection Privacy module：学生 create/read/update/delete 当日总结；普通总结对当前 active parent 可读；私密总结仅 student 本人与 active 且未撤销的明确 grant parent 可读。新关联 parent 不自动读取历史私密总结。
3. 实现逐 parent grant/revoke，所有读取实时核验 active relationship；P1 的 end relationship 在同一事务撤销目标 parent 对该 student 私密资源的 active grants，并写 audit/outbox。grant/revoke/end 后旧 session 的 epoch 行为和刷新 session 下的资源 403 均须可验证。
4. 添加薄 Route、DTO/Zod/错误映射和最小响应式界面：学生当天总结编辑、普通/私密切换、私密 parent 授权管理；parent 只可读取授权内容。桌面和 360px 完成同一主路径。
5. 完成数据库约束、模块/Route 授权矩阵、双 parent + 双 student 隔离、grant/revoke/end 并发与幂等、audit/outbox、UI E2E，以及 P1/M1–M3 回归证据。

## 禁止范围

- 禁止 M5 训练、M6 导出/删除/兑换、媒体附件、评论、通知渠道、管理员紧急访问、自定义 parent 权限、依赖升级、历史重写、merge/rebase/reset/push/deploy。
- 禁止把 family membership、客户端状态或缓存作为敏感读取授权源；不得让普通总结转为私密或自动授予新 parent 历史私密内容。

## P2 完成定义与验证

- 覆盖 AC-M4-4，且不回退 AC-M4-1～3/5；为每条 Route/错误路径/权限矩阵提供可定位测试。
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

- 一个聚焦提交；更新 P2 implementation record/验收矩阵，报告完整 SHA、执行基线、AC/R-ID、迁移/约束、并发时序、Route/UI 证据、命令原始摘要和 blocker。

最后只能写：**“M4 P2 私密授权闭环已交 Codex 审核（非 GO）。”**
