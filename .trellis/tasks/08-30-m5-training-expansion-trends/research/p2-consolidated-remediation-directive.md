# M5 P2 集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定候选实现 SHA：`9747f72b4ed7113267a2f7b4aadcd134935f77f8`
>
> 整改轮次：**P2 第 2/3 轮；一次性关闭 P2-R01～P2-R03。**
>
> 结论：**NO-GO；只授权本文件整改，不授权 P3。**

## 1. 审核结论与验收线

P2 的 Route、窗口、segment、排除规则和实时关系授权未发现新的生产级阻断。以下三项均直接影响 R-M5-05 / AC-M5-06 与冻结设计中的增量/rebuild 一致性，必须在同一整改提交中关闭。

512 行 service 的职责偏多、匿名 projection row 数据簇和方向 map 的轻微重复只记为非阻断代码债；不得为此扩大本轮重构。

## 2. P2-R01 — 全量 rebuild 遗留无有效源记录学生的陈旧投影

- **依据**：`prd.md` R-M5-05、AC-M5-06；`design.md` §4；`p2-execution-directive.md` §2.5。
- **位置**：`src/modules/training/trends.service.ts` 的全量 `rebuildTrainingProfileProjection`；`tests/integration/projection/rebuild-training-projection.test.ts`。
- **原因**：全量入口只从当前 completed/effective sessions 枚举 student ID，并仅在全库没有任何该类 session 时全表删除。若学生 A 已无权威有效源但仍有旧 projection，同时学生 B 仍有有效源，A 不会被处理，其陈旧 projection 永久保留。
- **修订动作**：在同一事务中让全量 rebuild 的最终 projection 精确等于全部权威 completed/effective session 的归约结果；清除不在权威源学生集合中的陈旧行，同时保持按 student 定向 rebuild 语义正确。采用最小、集合化且事务安全的实现，不新增 migration。
- **验证**：新增双学生数据库回归：A 只有陈旧 projection、无 completed/effective session；B 有有效源。执行全量 rebuild 后 A 为 0 行、B 与权威归约一致。再覆盖全库无有效源与重复 rebuild 幂等。

## 3. P2-R02 — 增量 conflict update 未刷新 `lastFamilyDate`

- **依据**：R-M5-05 / AC-M5-06；`design.md` §4 的增量/rebuild 一致性；`AGENTS.md` 数据完整性要求。
- **位置**：`src/modules/training/session.service.ts` 的 `upsertProfileProjection` conflict update；`src/modules/training/trends.service.ts` rebuild 写入。
- **原因**：insert 写入 `windowSummary: { lastFamilyDate: input.familyDate }`，但后续 conflict update 只更新 best/last/source session，不更新 `windowSummary`。同 segment 第二条 effective session 后，增量 projection 的 `lastFamilyDate` 保持旧值，而 rebuild 写入新值。
- **修订动作**：确保每次增量有效会话更新 `windowSummary.lastFamilyDate`，并使其与 reducer/rebuild 的最后会话语义一致；不得使用当前系统日期替代 session 的冻结 family date。
- **验证**：同 segment 连续两条不同 family date 的 effective session，断言增量 row 的 last value、last source session 和 `windowSummary.lastFamilyDate` 都指向第二条；rebuild 后完整保持一致。

## 4. P2-R03 — 增量与 rebuild 未复用同一 reducer/聚合入口

- **依据**：`design.md` §4：“投影更新与 rebuild 共用同一 reducer/聚合入口”；`p2-execution-directive.md` §2.2。
- **位置**：`profile-projection-reducer.ts`、`session.service.ts` 增量路径、`trends.service.ts` rebuild 路径及实施记录。
- **原因**：rebuild 调用 `mergeMetricIntoProjectionState`，增量路径自行循环、查 row、计算 best 并 upsert，只共享 `computeBestValue`/filter 等零件，不是同一 reducer 入口；实施记录“incremental upsert uses reducer”与实现不符。
- **修订动作**：提炼一个两条路径实际共同调用的聚合入口，统一 eligible metric、direction、best/last/source/family-date 状态转换；数据库读写仍可留在各自边界。禁止用测试 mock 伪造共享，禁止引入第三方依赖或大范围架构改造。
- **验证**：测试同时覆盖 lower/higher-is-better、排除指标、invalid metric、第二条会话 last 字段，以及增量与 rebuild 的完整 row parity（包括 `windowSummary.lastFamilyDate`）。更新 implementation record，使描述与真实调用链一致。

## 5. 允许范围与禁止项

只允许修改关闭 P2-R01～P2-R03 所需的：

- `src/modules/training/profile-projection-reducer.ts`
- `src/modules/training/session.service.ts`
- `src/modules/training/trends.service.ts`
- P2 projection/training 聚焦测试
- `research/p2-implementation-record.md`

禁止修改 PRD/design/implement、本整改文件、P1 helper、Route/UI、schema/migration；禁止启动 P3/M6、依赖升级、无关重构、merge/rebase/reset/push/deploy。

## 6. 完成定义与验证

1. P2-R01～P2-R03 均有可定位回归证据，且原有 AC-M5-05～07 不回退。
2. 无其他测试 runner 时串行执行：

```bash
pnpm test tests/unit/training
pnpm test tests/integration/training/m5-trends.test.ts
pnpm test tests/integration/projection
pnpm test tests/integration/api/m5-trends-routes.test.ts
pnpm test tests/integration/family-access
pnpm typecheck
pnpm lint
pnpm format
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

3. 可额外运行完整 `tests/integration/training`，但已签署为非阻断的 P1-R32 helper 清理诊断失败不得扩大为 P2 修改。
4. 只创建一个聚焦整改 commit，更新实施记录并如实记录全部命令结果。

## 7. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整整改 SHA>
execution_base: <包含本指令的完整 SHA>
status: M5 P2 集中整改已交 Codex 审核（非 GO、未启动 P3）

resolved:
- P2-R01: <实现与双学生/空源/幂等证据>
- P2-R02: <第二条会话 lastFamilyDate 与 parity 证据>
- P2-R03: <两条路径共享入口及方向/排除/invalid 证据>

changed_files:
- <文件>

verification_raw_summary:
- <实际命令>: <原始摘要>

blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P2 集中整改已交 Codex 审核，未启动 P3。”**
