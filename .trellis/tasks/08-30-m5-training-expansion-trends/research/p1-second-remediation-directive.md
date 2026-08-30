# M5 P1 第二轮集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定审核 SHA / 整改基线：`920851003b1d5bfe3cf7e5eae1265e38656cbe92`
>
> 上轮指令提交：`fecac3f4f1e4d149d3b310c08de001fc7dd814f5`
>
> 结论：**NO-GO；本轮必须一次性关闭 P1-R08～P1-R12，禁止启动 P2。**

## 1. 审核结论与证据

上轮 P1-R01、R02、R05 已关闭；R03、R04、R06、R07 尚未形成完整验收证据，具体缺口已重新编号为本文件 R09～R12。工程规范轴另发现 R08。

Codex 对固定 SHA 独立串行执行以下质量门，全部退出码为 0：

- `pnpm db:migrate`；
- `pnpm test tests/unit/training`；
- `pnpm test tests/integration/migrations`；
- `pnpm test tests/integration/training`；
- `pnpm test tests/integration/outbox tests/integration/audit`；
- `pnpm typecheck`、`pnpm format`；
- `pnpm lint`：0 error / 3 个既有 warning。

测试全绿不能替代缺失的验收矩阵与确定性并发证据。

## 2. 必读与允许范围

完整读取本文件，以及：

1. `prd.md`：R-M5-01～04、R-M5-08，AC-M5-01～04；
2. `design.md`：§1～3、§6～7；
3. `implement.md`：P1；
4. `research/p1-consolidated-remediation-directive.md`；
5. `.trellis/spec/guides/code-reuse-thinking-guide.md` 与 backend database/quality 规范。

只允许修改关闭 R08～R12 所需的 P1 protocol/shared helper、前向 migration、training/migration tests 与 P1 implementation record。不得修改 PRD、design、implement、本文件、任务状态或 P2/P3 文件。

## 3. 全部整改项

### P1-R08 提取三协议共用的安全正整数校验（中）

**依据**：code-reuse thinking guide 要求相同逻辑出现三处及以上时提取复用。

**现状**：`reaction-v1.ts`、`stroop-v1.ts`、`digit-span-v1.ts` 各自复制了相同的 `isSafePositiveInt`。

**修订**：在现有 protocol 模块内提取最小共享 helper，三协议复用；不得引入新依赖或无关抽象。保持既有边界语义，并由现有/聚焦单测证明无回归。

### P1-R09 补齐 Digit Span 时间不变量与完整协议验收矩阵（高）

**依据**：P1-A 要求未知、缺失、乱序、重复事件和非法边界确定性拒绝；AC-M5-02/03。

**现状**：Digit Span validator 未读取 `occurredAt`，会接受 response 早于 stimulus；现有矩阵仍缺 Stroop 重复 response、错误答案、负向时间，以及 Digit Span 重复 response、时间乱序和明确的错误答案接受/指标断言。

**修订**：

- Digit Span 对相关事件时间执行有限数校验，并拒绝 response 早于对应 stimulus；不得只依赖数组顺序。
- 增加上述 Stroop 与 Digit Span 用例；错误答案应按协议合法完成并产生正确指标，结构/时间异常才 invalid。
- 测试名称直接标明协议与被证明的不变量；保持 reaction v1 历史兼容。

### P1-R10 用数据库竞争窗口证明并发不变量（高）

**依据**：R-M5-04、AC-M5-04；上轮 P1-R03 明确要求独立连接、真实事务边界和确定性同步点。

**现状**：`m5-concurrency.test.ts` 的 barrier 位于调用 service 之前，只证明请求同时起跑，未确定两个事务均到达目标数据库竞争窗口；metrics 仅断言 `> 0`，不能证明每个 session 只写一组。

**修订**：

- 通过数据库或仅测试边界的确定性同步手段，让两个独立连接/事务确实在 effective 唯一约束或 submit 幂等竞争窗口相遇；不得向生产 service 导出 test hook。
- 两类并发场景继续分别证明：双 session 恰一 effective/一 practice；同 session 同 key 一次首次结果、其余重放。
- 对每个 session 的 metric 行数按该 definition schema 的精确期望值断言，并精确断言完成 audit/outbox 数量；不得使用 `> 0` 替代去重证据。
- 测试应可在无并发测试干扰时重复串行运行。

### P1-R11 收紧 definition 生命周期并补齐全部数据库字段证据（高）

**依据**：R-M5-01；P1-D 规定不可变字段冻结，唯一允许的生命周期更新是 `active: 1 → 0`，禁止重新激活。

**现状**：`0021_m5_definition_immutability.sql` 只拒绝 `0 → 1`，仍允许 `1 → 2`、`0 → 2` 等非法 active 变化；数据库测试只分别覆盖 `training_key`、`metric_schema`，未独立证明 `version`、`age_band` 不可修改。

**修订**：

- 新增前向 migration（不得改写已应用 0021），使 active 不变或 `1 → 0` 为唯一合法情况；拒绝其他 active 值/转换，并保留四个不可变字段保护。
- 更新 migration journal。
- 真实数据库测试分别证明 `training_key`、`version`、`age_band`、`metric_schema` 更新均被拒绝，`1 → 0` 被允许，`0 → 1` 与其他非法值/转换被拒绝。

### P1-R12 修正实施记录，不得超前宣称关闭（中）

**依据**：P1-E、固定 SHA 审核与证据矩阵要求。

**现状**：当前 implementation record 将 P1-R03/R04/R06/R07 标记为已关闭，但 R09～R11 所列证据仍缺失。

**修订**：更新 record，准确列出原实现 SHA、两轮整改基线、R08～R12 的测试定位和命令原始摘要。不得预写未知最终 HEAD；实际提交 SHA 只在回报中给出。若任何验证未运行或失败，必须如实列为 blocker。

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
git diff --check 920851003b1d5bfe3cf7e5eae1265e38656cbe92..HEAD
```

## 5. 禁止项与完成定义

- 禁止 P2、P3、M6、依赖升级及无关重构。
- 禁止修改本指令和任务规格/状态；禁止 merge、rebase、reset、push、deploy、归档。
- 只提交一个聚焦整改 commit，建议：`fix(m5-p1): close second review findings`。
- R08～R12 全部关闭、质量门按实际结果记录、工作区干净后，只能声明“已交审核”。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位整改 SHA>
remediation_base: 920851003b1d5bfe3cf7e5eae1265e38656cbe92
status: M5 P1 第二轮整改已交 Codex 审核（非 GO、未启动 P2）

resolved:
- P1-R08 ...
- P1-R09 ...
- P1-R10 ...
- P1-R11 ...
- P1-R12 ...

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始摘要>

unresolved_or_blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P1 第二轮整改已交 Codex 审核，未启动 P2。”**
