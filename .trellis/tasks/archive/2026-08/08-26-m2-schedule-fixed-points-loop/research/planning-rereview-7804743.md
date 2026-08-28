# M2 规划复审 Checklist — `7804743`

**审阅范围**：`9c9a1a6...7804743`；仅规划文件，未启动 `task.py start`，未开始实现。

## 结论

**NO-GO**。Cursor 必须逐项关闭下列所有 `FAIL`，在同一主题回报提交 SHA、对应章节及验证结果后，方可请求复审。

| ID | 结果 | 位置 | 必须修订 | 验证 |
| --- | --- | --- | --- | --- |
| C1 | PASS | `task.json` | 任务仍为 `planning`，本轮无业务代码/迁移。 | `git status --short --branch` |
| C2 | PASS | `prd.md`、`design.md`、`implement.md` | 主体已无“同前”“…”占位。 | 文档检索 |
| C3 | FAIL | `PLANNING-REVIEW.md:3-4` | 清除尾随空格；审阅命令必须检查本轮差异，而非仅工作区差异。 | `git diff --check 9c9a1a6...HEAD` |
| C4 | FAIL | `implement.md` §2 | 将迁移计划改为逐表可执行约束：字段、PK/FK、active formal 部分唯一、`occurrence_key`、状态/事件 CHECK、actor/hash、ledger 唯一、projection PK/UPSERT。 | 迁移计划与 `design.md` §4.2 一一对应 |
| C5 | PASS | `design.md` §4.8、§6 | GET/list 零写；expired 仅于命令/维护事务持久化。 | AC-M2-F5/F6/F7/F8 |
| C6 | FAIL | `design.md` §5.1、§5.2、§5.8 | 生成上界统一为 `min(plan.endDate, currentFamilyDate + 30)`；计划已到结束日时 maintain 为 no-op；编辑缩短 `endDate` 时，取消新结束日后的 future pending。 | 创建、缩短结束日、维护三类集成测试 |
| C7 | FAIL | `design.md` §5.0、§5.4、§5.4b | 已有 `FOR UPDATE`，但同 key 并发的第二请求锁后会直接 409。锁后重新查询同 key event，或用原子 INSERT 冲突后读取；同 key 必须 200 回放，异键后到 409。 | complete×complete、complete×skip：同/异 key、异 actor；只一条终态 event/fact/settlement/ledger |
| C8 | FAIL | `design.md` §5、§6.1；`implement.md` §4 | 为全部写 Route 固定 `Idempotency-Key` 缺失契约（推荐 `400` + 稳定错误码），并加入 Route/API 测试。 | 七类写 Route 缺 header 测试 |
| C9 | FAIL | `design.md` §4.2、§5.5 | 删除 ledger 全局 `UNIQUE(idempotency_key)`，或改为 settlement-scoped 派生 key；保留 `UNIQUE(settlement_id)`。只有 `INSERT ledger ... RETURNING` 实际插入新行时才 `balance += amount`；冲突只能读取回放，不能累加。 | 不同 item 同客户端 key 各自记账；回放/冲突后 ledger 数、余额均不变 |
| C10 | FAIL | `design.md` §10、`implement.md` §4、`research/m2-verification-matrix.md` | 增加并映射 C6-C9 的测试：endDate、终态并发、缺 header、ledger 冲突/余额不变。 | 矩阵逐项映射且集成测试计划存在 |
| C11 | PASS | `design.md` §4.6–4.9、§5.8；`implement.md` §4.3 | occurrence key、状态机、outbox dedupe、显式 maintain、双端完整 E2E 已定义。 | AC-M2-2/7/8、F14/F21 |

## 强制修订顺序

1. **C9**：先固化 ledger 与余额原子性。
2. **C7**：再固化日程终态并发与回放。
3. **C6**：补结束日期边界与存量实例处置。
4. **C8、C4、C10、C3**：补 HTTP 契约、迁移门禁、测试映射与格式。

## 禁止事项

- 不执行 `task.py start`，不创建实现分支。
- 不写迁移、Route、业务代码或 E2E。
- 不引入 `command_log` / `command_idempotency` 泛用表、Worker、cron 或 GET 写库。
