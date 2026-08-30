# M5 P1 第三轮集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定审核 SHA / 整改基线：`da3a2ce3ed97719b87c8181be3a2ce898efad77c`
>
> 第二轮指令提交：`adbe91f3c6d1bdf8f4ca16a7a45b3455b7f3db3e`
>
> 结论：**NO-GO；必须一次性关闭 P1-R13～P1-R17，禁止启动 P2。**

## 1. 审核证据

Codex 对固定 SHA 完成规格轴、工程规范轴和独立串行质量门。以下命令均退出 0：

- `pnpm db:migrate`；
- `pnpm test tests/unit/training`：4 files / 34 tests；
- `pnpm test tests/integration/migrations`：6 files / 34 tests；
- `pnpm test tests/integration/training`：4 files / 24 tests；
- `pnpm test tests/integration/outbox tests/integration/audit`：3 files / 23 tests；
- `pnpm typecheck`、`pnpm format`；
- `pnpm lint`：0 error / 3 个既有 warning。

测试通过不能替代下列缺失的不变量证据。第二轮 R08 的复用方向正确，但 helper 语义仍需由 R16 修正；R09～R12 尚未完整关闭，缺口重新编号如下。

## 2. 必读与范围

完整读取本文件、`research/p1-second-remediation-directive.md`、`prd.md` 的 R-M5-01～04/R-M5-08 与 AC-M5-01～04、`design.md` §1～3/§6～7、`implement.md` P1，以及 backend database/quality 和 code-reuse guide。

只允许修改关闭 R13～R17 必需的 P1 protocol/shared helper、前向 migration、training/migration tests、测试 helper 与 P1 implementation record。不得修改任务规格、本指令、任务状态或 P2/P3 文件。

## 3. 全部整改项

### P1-R13 让真实 submit 事务确定性进入竞争窗口（高）

**依据**：第二轮 R10 要求两个独立连接/事务确实在 effective 唯一约束或 submit 幂等竞争窗口相遇，不接受 service 调用前 barrier。

**现状**：`signalSubmitRaceArrival` 仍在调用 `submitTrainingSession` 前同步；`assertCompetitionAdvisoryLockContention` 是与两次真实 submit 分离的合成锁测试。因此它只证明 PostgreSQL 锁可争用，未证明被验收的两个 submit 事务发生了目标争用。精确 side-effect 数量断言已正确补齐，须保留。

**修订**：

- 用数据库级编排或仅测试边界的确定性手段，使被断言结果的两次真实 submit 在实际 advisory/row/idempotency 竞争窗口形成等待关系；不得向生产 service 导出 test hook。
- 在测试中通过 `pg_locks`、事务状态或等价数据库证据，定位正在执行的真实 submit backend，并先证明一个持有目标锁、另一个等待同一目标锁，再释放并断言最终结果。
- 双 session 与同 session 同 key 两类场景都必须有对应真实竞争证据；不得用独立合成锁用例替代。
- 保留每 session 精确 metric 数量以及 audit/outbox 精确去重断言；清除不再需要的 witness/table/helper。

### P1-R14 拒绝所有非有限事件时间（中）

**依据**：第二轮 R09 明确要求 Digit Span 对相关事件时间执行有限数校验；AC-M5-02/03 要求异常时间确定性拒绝。

**现状**：Digit Span 和 Stroop 只比较 `getTime()` 的大小。`Invalid Date` 返回 `NaN`，`NaN <= x` 与 `x <= NaN` 均为 false，因此可绕过校验。

**修订**：在使用事件时间前显式验证 stimulus 和 response 的 epoch 值均为 finite，再验证 response 严格晚于 stimulus。为 Digit Span、Stroop 各增加 invalid stimulus time 与 invalid response time 回归；保持 reaction v1 既有兼容语义，除非现有规格已要求且测试证明必须同步处理。

### P1-R15 在 INSERT 与 UPDATE 上封闭 active 值域（高）

**依据**：第二轮 R11 要求 active 不变或 `1 → 0` 为唯一合法情况，并拒绝其他 active 值/转换。

**现状**：0022 trigger 仅在 `OLD.active IS DISTINCT FROM NEW.active` 时检查值域，且只作用于 UPDATE。数据库仍可接受 `INSERT active=2`；若存在非法旧数据，`2 → 2` 也不会被拒绝。

**修订**：

- 新增前向 migration（禁止改写 0022），以数据库约束确保每行 `active IN (0,1)`，覆盖 INSERT 和 UPDATE；保留 trigger 对生命周期 `0 → 1` 的拒绝及 `1 → 0` 的允许。
- 迁移前若可能存在非法值，采用明确且安全的失败策略，不得静默改写数据。
- 更新 migration journal；测试分别证明 INSERT 2、有效行 UPDATE 2、`0 → 1` 被拒绝，`1 → 0` 被允许；如可构造历史非法行，还要证明新约束安装时失败或非法不变更新不可存在。

### P1-R16 兑现 safe-positive-integer 语义（中）

**依据**：第一轮 R06 要求所有计数/配额/长度/attempt 配置为安全整数；第二轮 R08 要求共用安全正整数校验。

**现状**：`isSafePositiveInt` 使用 `Number.isInteger`，会接受超出 `Number.MAX_SAFE_INTEGER` 的整数；名称与契约不符。

**修订**：使用 `Number.isSafeInteger` 并保持正数条件，三协议增加至少一组超过安全整数上限的 schema 回归，证明确定性拒绝。不得仅改名弱化既定规格。

### P1-R17 修正实施记录（中）

当前 record 超前将 R09～R12 表述为 resolved。更新为准确记录三轮指令/基线、R13～R17 的真实测试定位与命令摘要；不得预写未知最终 HEAD。实际 SHA 仅在 Cursor 回报中给出，未运行或失败项必须列为 blocker。

## 4. 验证命令

在无其他测试进程时串行执行：

```bash
pnpm db:migrate
pnpm test tests/unit/training
pnpm test tests/integration/migrations
pnpm test tests/integration/training
pnpm test tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
git diff --check da3a2ce3ed97719b87c8181be3a2ce898efad77c..HEAD
```

## 5. 禁止项与完成定义

- 禁止启动 P2/P3/M6、依赖升级及无关重构。
- 禁止修改本指令、PRD/design/implement/task status；禁止 merge/rebase/reset/push/deploy/归档。
- 只提交一个聚焦整改 commit，建议：`fix(m5-p1): close third review findings`。
- R13～R17 全部关闭、质量门如实记录、工作区干净后，仅声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: da3a2ce3ed97719b87c8181be3a2ce898efad77c
status: M5 P1 第三轮整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R13 ...
- P1-R14 ...
- P1-R15 ...
- P1-R16 ...
- P1-R17 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 第三轮整改已交 Codex 审核，未启动 P2。”**
