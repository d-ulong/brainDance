# M4 P1 集中整改 Cursor 执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 审核实现 SHA：`b401fc048b0047bbdc52916969f1b20fa69b6c55`
>
> 结论：**NO-GO；仅授权关闭本文件的 P1-R01～P1-R05。**

## P1-R01 — 家长已有家庭时不得为第二名学生新建 family（P1 / AC-M4-2）

`resolveFamilyIdForAcceptance()` 只读取 student 的 active relationship。故 parent 已在 family A、未关联 student B 时，B 的接受流程会新建 family B；这与“一个家长可在同一家庭管理多名学生”冲突，且新增测试中 `expect(rel1.familyId).toBe(rel2.familyId)` 无法成立。

- 同时解析 parent 与 student 的 active family：仅一侧存在时复用该 family；两侧均不存在时新建；两侧同一时复用；两侧不同必须明确拒绝，不能悄然跨 family 建关系。
- 以确定顺序锁定相关 user/relationship，覆盖并发首次关联及同 parent 关联第二名学生的时序。
- 增加上述四种分支及并发测试；真实运行后，P1 record 不得把 skipped DB test 当成 passed。

## P1-R02 — 并发结束不同关系必须收敛 membership（P1 / AC-M4-2、AC-M4-3、AC-M4-5）

当前 `reconcileMembershipAfterRelationshipEnd()` 在无 membership/user 聚合锁的情况下读取 remaining relation。一个 parent（或 student）两条关系被两个事务并发结束时，双方都可见对方尚未提交的 active relation，均不写 `left_at`，最终留下无 active relationship 的 active membership。

- 在同一事务内对每个受影响 `(family_id,user_id)` 的 membership 或稳定聚合行加锁后再计算/更新；锁顺序必须确定，避免 parent/student 并发结束死锁。
- 添加两个独立连接 + barrier 的并发结束测试：两条关系均结束后，相关 parent/student 不得保留 active membership；单条结束仍保留另一有效关系的 membership。

## P1-R03 — P1 发出的 outbox event 必须被 M3 Worker 显式处理（P1 / 事务 outbox）

P1 的 `deactivateCreatorConfigsOnRelationshipEnd()` 新增 `point_rule.deactivated`，并额外写入 `plan.deactivated`；当前 Worker 只支持 `schedule.completed`/`point_rule.enabled` noop 和 M3 fact/points handlers。事件会作为 unknown event 重试至 dead，违背可靠投递。

- 为 P1 会发出的 `relationship.ended`、`plan.deactivated`、`point_rule.deactivated`（v1）提供显式幂等 handler 或受测试的 supported-noop 声明；不得把未知事件静默吞掉。
- 补 Worker 集成测试，逐个断言处理后 status=processed、无 dead/retry 副作用；保留 unsupported event 进入 dead 的既有测试。

## P1-R04 — 补齐 Route 与配置处置的可定位证据（P1 / AC-M4-2、AC-M4-3、AC-M4-5）

当前新增测试只直接调用 service，未证明真实 Route/session DTO 在结束后阻止离关联 parent 读取目标 student 且允许同 family 其他有效关系；计划/规则停用也未断言逐项 audit/outbox。

- 以真实 HTTP Route/session 路径补最小 2xx/403 矩阵：结束目标 relationship 后，离关联 parent 对目标 student 为 403，对仍关联 student 仍可 200；响应不得泄露目标 student 数据。
- 对每个被停用 plan/rule 断言一次 audit 与一次 outbox，且 replay/并发不重复。

## P1-R05 — 验证记录必须报告真实执行结果（P1 交接证据）

`p1-implementation-record.md` 缺少指令要求的命令原始摘要；当前数据库测试是否实际执行不可由记录判断。

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

- 记录每条命令的 exit code、测试 files/tests/skip 数与既有 lint warning；未执行项必须写明，不得写成通过。

## 边界、提交和回报

只修改上述整改需要的 M4 P1 service/schema/migration/worker/Route/test/implementation record。禁止 Reflection Privacy/每日总结/私密 grant、M5/M6、依赖升级、merge/rebase/reset/push/deploy。

提交一个聚焦整改 commit；回报 branch、完整 HEAD、完整执行基线、已关闭 P1-R ID、修改文件、迁移/约束/worker event、真实并发时序、Route 证据、命令原始摘要和 blocker。最后只能写：**“M4 P1 集中整改已交 Codex 审核（非 GO）。”**
