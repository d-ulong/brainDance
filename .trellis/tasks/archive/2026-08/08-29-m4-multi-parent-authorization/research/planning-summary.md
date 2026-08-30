# M4 规划摘要

## Goal

让同一家庭中的多个家长可分别与多个学生维持有效关系；结束其中一条关系时，访问权、成员投影、私密总结授权和创建者配置只按该关系的真实范围收回，其他仍生效的关系不受影响。

## Frozen scope

1. 已有家庭的学生可接受第二位及后续家长；关系加入既有 family，不得产生第二个 active family。
2. `family_memberships` 仅由该 user 在该 family 的 active relationships 聚合派生；不得作为授权源。
3. 结束关系必须在一事务内重算 membership、递增授权 epoch、撤销目标 parent 的私密 grant、写 audit/outbox，并只停用该 parent 对目标 student 的未完成配置。
4. 新增仅文本每日总结：普通总结供所有 active parent 读取；私密总结按 parent 单独 grant/revoke；关系结束和 grant 撤销即时拒绝且不泄露正文。

## Acceptance criteria

- AC-M4-1：第二位家长可加入同一学生既有 family，两个 parent 均可读取各自授权范围。
- AC-M4-2：一个 parent 与两名学生关联时，结束其中一条关系不影响另一条关系的授权或 membership。
- AC-M4-3：最后一位 parent 离开后学生进入无家长状态；重新关联不恢复旧 grant 或停用配置。
- AC-M4-4：私密总结只对 active 且显式授权的 parent 可读；逐项撤销、关系结束和并发读/撤权均无正文泄露。
- AC-M4-5：接受、结束、grant/revoke 幂等，事务内带 audit/outbox，并发不破坏关系/成员不变量。
- AC-M4-6：Route 2xx/4xx/403、DTO 脱敏、360px 主路径及数据库/静态/E2E 质量门均有证据。

## Boundaries and risks

不包含 M5 训练、M6 生命周期/兑换、媒体/评论、通知渠道、管理员紧急访问或自定义权限分级。关键风险是现有 M1 结束关系逻辑会错误撤销仍有效关系，及缓存/投影被误当作授权源。

## Planned delivery waves

- P1：迁移与 Family Access 多关系/部分解除/授权基础，完成现有业务资源撤权回归。
- P2：Reflection Privacy 模块、逐家长私密授权、Route/UI/E2E 闭环。

P1/P2 均须在确认隔离测试数据库后串行运行 `pnpm db:migrate && pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm build && pnpm test:e2e`，并以固定 SHA 交审核。
