# M5 P2 最终并发整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定整改候选 SHA：`385d2de86df6c2f2d408898fb1d4017070b9be03`
>
> 验收线审计：**第 3/3 轮后仅发现一个新生产级并发数据风险 P2-R04；只授权关闭该项。**
>
> 结论：**NO-GO；禁止启动 P3。**

## P2-R04 — 全量 rebuild 使用事务外陈旧学生集合

- **依据**：R-M5-05、AC-M5-06；`design.md` §3/§4/§6；集中整改 P2-R01“在同一事务中使最终 projection 精确等于权威 completed/effective 源”。
- **位置**：`src/modules/training/trends.service.ts` 的全量 `rebuildTrainingProfileProjection`；生产 submit 投影写入路径；projection 并发测试。
- **原因**：当前先在 transaction 外执行 `SELECT DISTINCT student_id`，再开启 transaction，最后按该内存集合执行 `NOT IN` 删除。若一个此前不在集合中的学生在两步之间并发完成 effective session，其 submit 已写入的新 projection 可能被 rebuild 当作 orphan 删除，而权威 session 保留，造成生产数据漂移。
- **修订动作**：
  1. 权威 completed/effective 源的枚举、归约与 orphan 清理必须处于一致的数据库事务/快照内。
  2. full rebuild 与所有会产生 training projection 的 submit 必须通过数据库级互斥/串行化或等价机制消除上述交错；仅把查询移动进默认 `READ COMMITTED` transaction、延时、进程内 mutex 或测试 mock 均不足以证明安全。
  3. 保持 P2-R01 的双学生/空源清理、P2-R02 lastFamilyDate 和 P2-R03 共享 reducer 已关闭；不得扩大到非阻断类型/重复过滤重构。
  4. 若采用数据库 advisory lock，必须使用稳定、集中定义的 lock key/顺序并说明它如何与现有 submit 锁避免死锁；若采用 serializable transaction，必须实现并测试可控重试/失败语义。选择与仓库既有模式一致的最小方案。
- **验证**：新增确定性真实数据库交错测试：暂停 full rebuild 于权威集合/清理关键点，与此前无 effective session 学生的真实 submit 竞争；两者完成后断言权威 session 存在、projection 未丢失且与按学生 rebuild 等价。测试必须有有界超时和可靠释放，不递归审核测试 helper 的极端清理故障。

## 允许范围与禁止项

只允许修改关闭 P2-R04 必需的 training projection rebuild、生产 submit 协调、集中 lock key/helper、projection/training 并发测试及 `research/p2-implementation-record.md`。

禁止修改 PRD/design/implement、本文件、schema/migration、Route/UI、P1 race helper；禁止处理非阻断数据簇、JSON 类型或重复过滤；禁止启动 P3/M6、依赖升级、merge/rebase/reset/push/deploy。

## 完成定义与验证

无其他 runner 时串行执行：

```bash
pnpm test tests/integration/projection
pnpm test tests/integration/training/m5-trends.test.ts
pnpm test tests/integration/api/m5-trends-routes.test.ts
pnpm test tests/integration/family-access
pnpm test tests/unit/training
pnpm typecheck
pnpm lint
pnpm format
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

只创建一个聚焦 P2-R04 commit。更新实施记录，画出或逐步列明锁顺序/确定性交错，记录命令原始摘要。

## 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整整改 SHA>
execution_base: <包含本指令的完整 SHA>
status: M5 P2 最终并发整改已交 Codex 审核（非 GO、未启动 P3）

resolved:
- P2-R04: <生产协调机制、锁顺序与确定性并发测试证据>

regression:
- P2-R01: <双学生/空源清理证据>
- P2-R02: <lastFamilyDate parity 证据>
- P2-R03: <共享 reducer 证据>

changed_files:
- <文件>

verification_raw_summary:
- <实际命令>: <原始摘要>

blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P2 最终并发整改已交 Codex 审核，未启动 P3。”**
