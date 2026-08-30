# M5 P1 集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 审核实现 SHA：`cd7dac3934daabf7dea22fb07df3dbc71801f9b9`
>
> 原执行基线：`9f0418814515d2165ebba90b1e98da274ec4eacd`
>
> 结论：**NO-GO；必须一次性关闭本文件 R01～R07，禁止启动 P2。**

## 1. 审核证据摘要

Codex 在固定实现 SHA 上完成规格轴、工程规范轴与独立串行复验：

- `pnpm db:migrate`：通过；
- `pnpm test tests/unit/training`：4 files / 15 tests 通过；
- `pnpm test tests/integration/migrations`：6 / 33 通过；
- `pnpm test tests/integration/training`：3 / 17 通过；
- `pnpm test tests/integration/outbox tests/integration/audit`：3 / 23 通过；
- `pnpm typecheck`、`pnpm format`：通过；
- `pnpm lint`：0 error / 7 warnings，其中 `protocol.ts` 2 条和 `m5-protocols.test.ts` 2 条为本次新增。

测试全绿不等于 P1 验收矩阵完整。以下问题均已对照实际代码、PRD/design/P1 指令确认。

## 2. 必读范围

完整读取本文件，以及：

1. `prd.md`：R-M5-01～04、R-M5-08，AC-M5-01～04；
2. `design.md`：§1～3、§6～7；
3. `implement.md`：P1 与审核/回滚点；
4. `research/p1-execution-directive.md`；
5. backend database/logging/quality/error 规范与 cross-layer/code-reuse guides。

只允许修改关闭 R01～R07 所需的 P1 schema/migration、training service/protocol、tests 和 implementation record。不得改 PRD、design、implement、本文件、任务状态或 P2/P3 文件。

## 3. 全部整改项

### P1-R01 会话必须使用启动时 definition 快照（高）

**依据**：R-M5-01；design §1“历史按会话快照读取”；P1-D“定义不可原地修改，停用不影响历史读取”。

**现状**：`src/modules/training/session.service.ts` 的 `buildStartReplayResult` 与 `submitTrainingSession` 按 training key/age band 重新调用 `getActiveTrainingDefinition`，而非读取 `training_sessions.definition_id`。启动后若 v1 被停用并激活 v2，既有会话会被 v2 schema 校验；若没有 active definition，重放和提交直接失败。

**修订**：

- 增加按 `definitionId` 读取固定 definition 的单一 service helper；校验 definition id、training key、version、age band 与 session 快照一致。
- start 首次创建仍读取 active definition；start 幂等重放与 submit 必须使用 session 的固定 definition，不依赖当前 active 状态。
- 增加“start v1 → 停用 v1/激活 v2 → start replay/submit 仍按 v1 成功”的集成回归；覆盖“停用后无 active definition”时既有会话仍可重放/提交。

### P1-R02 practice 不得更新正式训练投影（高）

**依据**：R-M5-04、AC-M5-06；design §3 只允许 effective 更新正式投影。

**现状**：`submitTrainingSession` 在判定 `sessionKind` 后无条件调用 `upsertProfileProjection`，同日第二条 practice 可覆盖 best/last/source。

**修订**：只有最终 `sessionKind === "effective"` 才更新 `training_profile_projection`。增加同 training key 同日第二条 practice 指标更好/更差的回归，证明 projection 的 best、last、lastSourceSessionId 均保持首条 effective 结果。

### P1-R03 补齐真实并发不变量证据（高）

**依据**：R-M5-04、AC-M5-04；P1-D/P1-E 明确要求并发提交及指标、审计、outbox 去重证据。

**现状**：`m5-protocols.test.ts` 的三 training key 完成和 submit replay 均为串行；没有同 key 双会话竞争 effective，也没有同会话同幂等键并发提交。implementation record 不应据此声明 AC-M5-04 已覆盖。

**修订**：使用独立数据库连接/真实事务边界和确定性同步点（不得用生产 test hook），增加至少：

- 同学生、同 training key、同 family date 两个完整会话并发提交：恰一条 effective、一条 practice；各自指标只写一次；完成审计/outbox 不重复。
- 同一 session、同 submit idempotency key 并发提交：一个首次结果、其余为幂等重放；只有一组 metrics、一个完成审计和一个 outbox。
- 串行复跑证明无共享数据库测试干扰，不接受只写 `Promise.all` 但实际未跨连接/未进入竞争窗口的伪并发证据。

### P1-R04 数据库必须保护 definition 不可变字段（中）

**依据**：R-M5-01；P1-D“定义不可原地修改”。

**现状**：`0020_m5_training_constraints.sql` 只约束一个 active definition；已存在行的 `training_key`、`version`、`age_band`、`metric_schema` 仍可直接 UPDATE。

**修订**：增加最小数据库 trigger/guard，禁止修改上述不可变字段，但允许唯一的生命周期变更 `active: 1 → 0`；不得允许 `0 → 1` 重新激活旧版本。更新 Drizzle migration journal，并以真实数据库测试分别证明冻结字段拒绝、停用允许、重新激活拒绝。迁移须能从当前已应用 0020 的数据库前向升级，禁止改写已应用 migration。

### P1-R05 无效提交的状态与审计必须同事务，并消除重复分支（高）

**依据**：backend database/logging guidelines；design §3 的事务原子边界。

**现状**：`session.service.ts` 新增的 computed-metric rejection 先提交 `training_sessions.status=invalid`，随后才在事务外 `appendAuditEvent(db, ...)`；审计失败会留下无审计的状态。它还与 validation rejection 分支重复 update、唯一冲突、audit 和返回 DTO，易继续漂移。

**修订**：提取一个共享的事务型 invalid-session helper，使状态、submit idempotency key 与 invalid audit 同事务提交；两个 rejection 来源复用该 helper；保留唯一冲突到幂等 replay/mismatch 的现有外部语义。增加故障注入/事务回滚测试，证明 audit 写入失败时 invalid 状态和 submit key 均不落库。

### P1-R06 严格拒绝未知事件、非整数 schema，并补齐协议矩阵（中）

**依据**：P1-A“未知/缺失/乱序/重复事件、非法边界必须确定性拒绝”；AC-M5-02/03。

**现状**：reaction/Stroop/digit-span validator 对未知 `eventType` 静默忽略；schema decoder 只检查 number/正数，允许小数 trial count、quota、长度和 attempts。现有测试未完整覆盖未知事件、非整数 schema、重复 response、非法时间顺序、digit-span 边界/乱序/错误 payload。

**修订**：

- 三协议遇到非本协议事件类型立即 invalid；所有计数、配额、长度、attempt index 配置必须为安全整数并满足上限/关系约束，时间边界必须为有限数。
- 保持 reaction v1 合法历史兼容；不得用 fallback 掩盖已存在 definition 的无效 schema。
- 为 Stroop 与 digit-span 补齐正常、错误答案、异常/负向时间、缺失、乱序、重复 stimulus/response、未知事件、非法 schema、长度/配额边界测试；测试名称必须能直接定位 AC-M5-02/03。

### P1-R07 修正交付证据与新增 lint warnings（中）

**依据**：P1-E、固定回报格式、backend quality guidelines。

**现状**：`p1-implementation-record.md` 记录 final HEAD 为 `04dd7f90...`，实际审核 SHA 为 `cd7dac393...`；记录把 AC-M5-04 表述为覆盖但缺真实并发证据。新增代码还引入 4 条 lint warning：`protocol.ts` 两个未使用 `_schema`，`m5-protocols.test.ts` 两个未使用 import。

**修订**：

- 更新 implementation record：保留原提交与整改提交的完整 SHA、逐项关闭 R01～R07、真实 AC 映射和全部命令原始摘要；不得写入无法预知的“最终 HEAD”，提交后在 Cursor 回报中给出实际 SHA，或明确 record 对应的被审核 SHA。
- 删除本次新增的 4 条 lint warning；既有 3 条 warning 可如实记录但不得扩大范围修复。
- 修正 AC-M5-04/02/03 的证据映射，只引用真实测试名称；列出任何未运行项。

## 4. 验证命令

在无其他测试进程条件下串行执行：

```bash
pnpm db:migrate
pnpm test tests/unit/training
pnpm test tests/integration/migrations
pnpm test tests/integration/training
pnpm test tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
git diff --check cd7dac3934daabf7dea22fb07df3dbc71801f9b9..HEAD
```

若使用测试故障注入，必须只存在于 test/helper 边界，不得向生产 service 导出 test hook。测试命令受环境阻塞时如实报告，不得表述为通过。

## 5. 禁止项与完成定义

- 禁止 P2 趋势查询/rebuild/授权、P3 UI/E2E、自适应课程、第四项训练、M6、依赖升级和无关重构。
- 禁止修改本整改文件、PRD/design/implement/task status；禁止 merge/rebase/reset/push/deploy/归档。
- 只提交一个聚焦整改 commit，建议：`fix(m5-p1): close consolidated review findings`。
- 完成定义：R01～R07 全部关闭，质量门按实际结果记录，工作区干净；仅声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: cd7dac3934daabf7dea22fb07df3dbc71801f9b9
status: M5 P1 集中整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R01 ...
- P1-R02 ...
- P1-R03 ...
- P1-R04 ...
- P1-R05 ...
- P1-R06 ...
- P1-R07 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 集中整改已交 Codex 审核，未启动 P2。”**
