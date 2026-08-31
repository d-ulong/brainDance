# M5 P1 第四轮集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定审核 SHA / 整改基线：`7a13c0674adf0b6983f431471c37399f742c929a`
>
> 第三轮指令提交：`0c232b76d1d9614a3eb1e943f08fbcc0a6bf8a56`
>
> 结论：**NO-GO；必须一次性关闭 P1-R18～P1-R22，禁止启动 P2。**

## 1. 审核结论

R14～R17 已实质关闭；R13 的真实 submit 编排方向正确，但锁身份匹配与失败清理仍不可靠。另发现 migration/schema 漂移和竞争锁 key 重复定义。

Codex 独立复验通过：聚焦 `m5-concurrency` 1 file / 4 tests、training unit 4 / 41、migration 6 / 35、typecheck、format，lint 为 0 error / 3 个既有 warning。绿测未覆盖以下异常/负 hash 路径。

## 2. 必读与允许范围

完整读取本文件、`research/p1-third-remediation-directive.md`、P1 implementation record、backend database/quality 规范和 code-reuse guide。

只允许修改关闭 R18～R22 必需的 training lock-key helper、session service、测试 helper/并发测试、Drizzle training schema 和 P1 implementation record。不得新增或改写 migration；0023 已是正确的前向 SQL 事实。

## 3. 全部整改项

### P1-R18 正确匹配负 hash 的 advisory bigint 锁身份（高）

**依据**：R13 要求确定性地以 `pg_locks` 定位真实 submit 锁。

**现状**：`readSubmitAdvisoryLockState` 将单参数 bigint advisory key 的 `classid/objid` 与有符号 `hashtext` 直接比较。`pg_locks` 暴露的是 64 位 key 的两个无符号 OID halves；负 hash 时当前 `classid = -1`、`objid = negative hash` 的匹配不可靠，可因随机 student UUID 得到负 hash 而超时。

**修订**：按 PostgreSQL 实际 bigint advisory-lock 编码，将高/低 32 位规范化为无符号 OID 值后匹配，或使用经数据库证明等价的重建表达式。增加固定正 hash key 与固定负 hash key 两个回归，均证明真实 submit backend 可被定位；不得依赖随机 UUID 恰好产生某个符号。

### P1-R19 保证观察失败时有界清理，不得死锁（高）

**依据**：工程规范要求必要错误处理；R13 要求确定性证据。

**现状**：若第一次 `waitForCondition` 超时或 runner 在到锁前失败，gate 仍持有目标 session advisory lock；`finally` 却先 `await Promise.allSettled(submitPromises)`，而剩余 submit 必须等 gate 解锁，形成永久等待，后面的 gate/client close 永远不会执行。

**修订**：跟踪 gate 是否持锁；所有退出路径必须先幂等释放锁或关闭 gate connection，再有界等待/cancel runners，最后关闭 monitor/clients。增加强制观察失败/runner 提前失败的聚焦回归，断言 helper 在短的明确上限内 reject 且无遗留 advisory lock/连接，不得让测试靠全局超时终止。

### P1-R20 同步 Drizzle schema 与 0023 CHECK（高）

**依据**：backend database guidelines 要求 TypeScript schema 与 SQL migration 保持同步。

**现状**：0023 已增加命名约束 `training_definitions_active_domain CHECK (active IN (0,1))`，但 `src/db/schema/training.ts` 仍只有 integer/notNull/default，未声明对应 named check。

**修订**：在 Drizzle table 定义中增加同名、同表达式 check；不得修改或新增 migration。增加/更新 schema metadata 测试（若现有测试框架适合）以防再次漂移，并确保生成类型不变。

### P1-R21 竞争锁 key 只能有一个生产定义（中）

**依据**：code-reuse guide；测试必须观察与生产完全相同的锁身份。

**现状**：`${studentId}:${trainingKey}:${familyDate}` 同时定义在 `session.service.ts` 和测试 helper。任一处漂移都会让并发证据观察错误锁。

**修订**：提取一个生产所属、无副作用的 domain key builder，由 session service 与测试 helper 共同调用；这不是 test hook，不得暴露测试控制能力。增加最小单测或通过既有并发测试证明使用同一 helper。

### P1-R22 修正实施记录（中）

更新 implementation record：R14～R17 可保留关闭；R13 必须在 R18/R19 完成后才声明可靠闭环；记录第四轮指令/基线、R18～R22 的真实证据和命令摘要。不得预写未知最终 HEAD；未运行/失败项列为 blocker。

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
git diff --check 7a13c0674adf0b6983f431471c37399f742c929a..HEAD
```

## 5. 禁止项与完成定义

- 禁止启动 P2/P3/M6、依赖升级及无关重构。
- 禁止新增/改写 migration，禁止修改本指令、PRD/design/implement/task status。
- 禁止 merge/rebase/reset/push/deploy/归档。
- 只提交一个聚焦整改 commit，建议：`fix(m5-p1): harden concurrency evidence cleanup`。
- R18～R22 全部关闭、质量门如实记录、工作区干净后，仅声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: 7a13c0674adf0b6983f431471c37399f742c929a
status: M5 P1 第四轮整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R18 ...
- P1-R19 ...
- P1-R20 ...
- P1-R21 ...
- P1-R22 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 第四轮整改已交 Codex 审核，未启动 P2。”**
