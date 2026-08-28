# M3 P1 Cursor 执行指令 — Schema and Module Contracts

> Active task: `.trellis/tasks/08-28-m3-ledger-reliability`
>
> 目标分支：`feat/m3-ledger-reliability`
>
> 固定执行基线：`4561562aac76bd93a15e8a26748123e2f1cd4313`
>
> `base_branch` / 父级基线：`main` / `d78a0a9c2a16a77e9f1ca94cb9a9c6e7836101a8`
>
> 状态：**批准执行 P1；P2～P5 未授权**

## 唯一授权目标

只交付 `implement.md` P1：M3 数据库迁移与 Drizzle schema、事实/更正和 Worker
领域错误契约，以及直接证明新增数据库不变量的约束测试。不得实现服务流程、Route、
Worker 消费循环、重放操作、CLI 或 UI。

## 必读规格

1. 本文件全部；
2. `prd.md` 的 M3-D01～D03、M3-R01～R06、AC-M3-1～AC-M3-7；
3. `design.md` 的 Boundaries、Schema and migration shape、Worker contract、Compatibility and rollback；
4. `implement.md` 的 P1、P1 verification matrix、Before P2 review gate；
5. `research/planning-signoff.md`；
6. `CONTEXT.md` 中“已确认事实”“事实更正”“日程事实更正窗口”“负积分余额”“规则前瞻生效”；
7. `docs/data-model.md` §4～§5、`docs/architecture.md` 的 Module/事务 outbox 约束；
8. `.trellis/spec/backend/database-guidelines.md`、`error-handling.md`、`quality-guidelines.md`；
9. `src/db/schema/points.ts`、`outbox.ts`、`index.ts` 和现有 M2 migration constraint tests。

## P1 稳定验收 ID

- **P1-01 Schema mirror**：SQL migration 与 Drizzle schema 完全对应；只做 M3 expand
  变更，不删除或改写 M1/M2 历史数据。
- **P1-02 Manual fact invariants**：人工 `error_count` 事实必须绑定正式日程、值为非负整数，
  能表达提交、确认、操作者、原因、命令幂等及 successor/superseded 链；系统事实既有约束保持有效。
- **P1-03 Immutable correction constraints**：数据库阻止同一前驱出现多个有效 successor，
  并阻止同一原流水被同一更正重复冲销；原 settlement/ledger 不更新或删除。
- **P1-04 Worker lifecycle schema**：outbox 具备 pending/leased/processed/dead、eligibility、
  租约 token/owner、attempts、last safe error code；尝试表保留 outcome、时间、错误类别、
  replay actor/reason，索引支持 claim 与 dead listing。
- **P1-05 Domain contracts**：事实/更正和后台投递模块拥有 typed error class 与
  string-literal error codes；本阶段不接 HTTP mapper，不写占位 service。
- **P1-06 Constraint evidence**：真实 PostgreSQL 测试证明允许与关键拒绝路径，并回归
  M2 settlement/ledger 与 transaction outbox schema。

## 允许范围

- `src/db/migrations/` 的一个聚焦 M3 expand migration；
- `src/db/schema/points.ts`、`outbox.ts`、`index.ts`，必要时一个紧邻 M3 schema 文件；
- `src/modules/facts/errors.ts`、`src/modules/outbox/errors.ts` 或与现有布局一致的最小错误契约；
- `tests/integration/migrations/` 的聚焦约束测试，以及测试编译所需的最小 helper 调整；
- 本任务目录的 P1 implementation record / verification matrix 状态更新。

超出范围时停止并回报 blocker，不得自行扩大授权。

## 禁止项

- 不修改 API Route、HTTP mapper、Route DTO、页面或 E2E；
- 不实现事实 service、settlement reversal、Worker loop/handler、dead/replay、日志或 rebuild CLI；
- 不新增依赖，不修改测试并行度，不删除/覆盖历史事实、settlement 或 ledger；
- 不重构 M1/M2，不 merge/rebase/push/deploy，不进入 P2，不自行宣布 P1 GO。

## 完成定义与验证

完成 P1-01～P1-06，并在共享 PostgreSQL 无并发干扰时串行执行：

```bash
pnpm db:migrate
pnpm test tests/integration/migrations/
pnpm test tests/integration/settlement/settlement-ledger.test.ts
pnpm test tests/integration/outbox/outbox-transaction.test.ts
pnpm typecheck
pnpm lint
pnpm format
```

未执行命令必须保留原始错误摘要并报告为 blocker，不得写“通过”。约束测试必须命中真实
PostgreSQL 约束，不能只检查 schema 字符串或 Drizzle 对象形状。

## 提交与固定回报

只提交一个聚焦 Cursor implementation commit，建议：
`feat(m3): add reliability schema contracts`。实施记录与代码同一提交。

回报逐项包含：`branch`；完整 `HEAD` SHA；完整执行基线
`4561562aac76bd93a15e8a26748123e2f1cd4313`；已解决 P1-01～P1-06；修改文件；
migration 与 constraint/index 数据库身份；验收 ID → 精确测试名；验证命令原始摘要；
未执行项及原因；blocker（无则“无”）。

结尾只能声明：**“M3 P1 实现已交 Codex 审核（非 GO）。”**
