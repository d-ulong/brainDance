# M4 P1 最终集中整改 Cursor 执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 审核实现 SHA：`1caf23f941c65dcfa2f514219969b8feac8da183`
>
> 独立复验：`pnpm test tests/integration/family-access/multi-parent-authorization.test.ts` → 10 passed / 2 failed。
>
> 结论：**NO-GO；仅授权关闭 P1-F01～P1-F05。**

## P1-F01 — 并发结束仍不可用（AC-M4-2、AC-M4-3、AC-M4-5）

`P1-R02: concurrent end of two student relationships converges parent membership` 的两个独立事务有一个 rejected；当前只锁 user 的补丁不足以让两个 end command 都成功。不得删除或弱化 barrier 测试。

- 定位并消除实际事务冲突；将同一 `(family_id,user_id)` 的关系结束聚合锁放在会造成冲突前的稳定位置，并使用确定的 parent/student 锁顺序。
- 保证两个不同 relationship 的并发 end 均 fulfilled；两条 relationship 结束后 parent 无 active membership；只结束一条时保留 active membership。
- 测试失败时输出/断言实际 rejection 原因，不能只断言 `allSettled` 布尔值而掩盖根因。

## P1-F02 — Route 应验证 epoch 刷新后的资源拒绝（AC-M4-2、P1-R04）

结束 Route 会刻意递增 authorization epoch 并返回新的 session cookie。测试沿用旧 cookie，得到 **401** 是正确的会话撤销结果，不是目标资源授权 **403** 的证据。

- 保留并断言旧 cookie 在 epoch 变化后为 401；从 end response 取得刷新 cookie 后，再断言目标 student profile 为 403（无数据泄露）、仍关联 student 为 200。
- 不得通过移除 epoch 递增或放宽 session 校验把 401 改成 403。

## P1-F03 — 配置停用的 outbox 测试不得依赖 FIFO 队首（P1-R03/P1-R04）

`P1-R04` 只调用三次 `processNextOutboxEvent()`，实际先领取 `invitation.redeemed`、`relationship.accepted`、`plan.created` 等既有 pending 事件，导致 plan/rule deactivated 仍为 pending。该测试不能证明目标事件已处理。

- P1-R04 仅断言每个被停用 plan/rule 的 audit/outbox 唯一且 replay 不重复；P1-R03 的独立 Worker 测试负责验证 `relationship.ended`、`plan.deactivated`、`point_rule.deactivated` 的 processed 状态。
- 不得通过吞掉或把未知既有事件一律标为成功来让测试通过。若需处理队列，须以明确 event id/可定位方式选择目标，且保留 unsupported event → dead 的回归。

## P1-F04 — M2/M3 迁移测试不得锁死“当前 journal 最后一条”（全量回归）

`m2-schema-constraints.test.ts` 两处及 `m3-schema-constraints.test.ts` 的断言把 journal head 固定为 `0017_m3_reversal_settlement_semantics`；M4 的合法 append-only `0018` 使它们失败。

- 改为断言所需 M2/M3 migration tag 存在且其隔离升级链仍正确；需要当前 head 时按 M4 已知 `0018_m4_multi_parent_authorization` 验证，而非让旧测试阻止后续 append-only migration。
- 保留从 M2/M3 起点升级到当前完整 migration 链的实际数据库测试。

## P1-F05 — 完整质量门与记录

完成 F01～F04 后，在 Docker Postgres 隔离且无并发 runner 条件下串行运行：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

更新 `p1-implementation-record.md`：每条命令 exit code、files/tests/skip、E2E passed、既有 lint warning、数据库隔离说明、完整执行 SHA。没有全绿不得进入 P2。

## 边界和交接

只改 F01～F05 所需的 M4 P1 service/test/worker test/migration regression/implementation record。禁止 Reflection Privacy/每日总结/私密 grant、M5/M6、依赖升级、merge/rebase/reset/push/deploy。

一个聚焦 commit；回报 branch、完整 HEAD、完整执行基线、已关闭 F-ID、修改文件、精确并发错误及修正时序、Route cookie 证据、Worker 事件证据、全部命令原始摘要和 blocker。最后只能写：**“M4 P1 最终整改已交 Codex 审核（非 GO）。”**
