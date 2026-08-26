# M2 Phase 3 Cursor 执行指令 — Schedule Domain

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> 目标分支：`feat/m2-schedule-fixed-points-loop`
> 已签署代码基线：`4a75baaf12d1bff9c41fcc9602286275b057ff00`
> 执行基线：以 Codex 交接通知给出的“包含本文件的提交 SHA”为准
> 阶段：implement §1 Phase 3
> 状态：批准执行

## 1. 启动门禁

Cursor 开始前必须运行：

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
```

分支必须一致，HEAD 必须等于 Codex 交接通知中的执行基线 SHA，且该提交包含本文件；工作区必须干净。开始时记录 `executionBaseline=$(git rev-parse HEAD)`，后续 diff 与回报均以此 SHA 为准。任一条件不满足则停止并回报 blocker。Cursor 已是实现者，直接实现，不再启动其他 implement/check agent。

## 2. 必读事实来源

1. `AGENTS.md` §2–§5。
2. `prd.md`：正式计划、日程生成、完成窗口、跳过、幂等；AC-M2-1/2/3/6/8；F1–F3、F5–F24、F26–F28。
3. `design.md`：§1–§3、§4.3–§4.9、§5.0–§5.4b、§5.7、§5.8A–B、§6。
4. `implement.md`：§1 Phase 3、§3 Schedule 布局、§4.1 occurrence-key/effective-status、§4.2 Schedule 测试、§6–§7。
5. `research/planning-signoff-checklist.md`：A1–A12、C8、C10–C12、R5–R10。
6. `research/frozen-go-gate.md`：FG-01、FG-02。
7. `research/phase1-consolidated-remediation.md` §10。
8. `research/phase2-remediation.md` §4。

实现前使用 `rg` 检查现有 module、transaction、family-access、audit、outbox、错误类型、测试 fixture 与 Drizzle schema 模式。复用 Phase 2 time-policy，禁止复制日期、时区、窗口或 horizon 算法。

## 3. 允许范围

- `src/modules/schedule/**`
- `tests/unit/schedule/**`
- `tests/integration/schedule/**`
- 必要且聚焦的 `tests/helpers/**`
- 仅当 Phase 1 Drizzle 导出不足以供 service 使用时，最小修订对应 M2 schema 导出；不得改变数据库契约或新增迁移。

计划模块：`plan.service.ts`、`generate-horizon-inline.service.ts`、`maintain-horizon.service.ts`、`schedule-query.service.ts`、`persist-expired.service.ts`、`occurrence-key.ts`、`normalize-idempotency-payload.ts`、`complete-schedule.service.ts`、`skip-schedule.service.ts`、`errors.ts`。可按现有风格做最小调整，不得增加无实际用途的 repository/controller 层。

## 4. 实现契约

### P3-01 幂等 payload 与错误

- 对命令 body 做稳定递归键序规范化，计算 SHA-256 hex；header 不进入 payload。
- 同语义对象不同键顺序必须得到同一 hash。
- 不新建 `command_log` / `command_idempotency`。
- 提供最小稳定领域错误：not-found、forbidden、idempotency conflict、state conflict、window expired、slot invariant。本阶段不实现 HTTP 映射。

### P3-02 occurrence key 与 effective status

- key 精确为 `{plan_id}:{plan_version_id}:{family_date}:daily:{localTime}`。
- `localTime` 必须来自指定 version 的 `default` slot。
- effective status：非 pending 返回持久状态；pending 且 `isPastCompletionWindow()` 返回 expired；否则 pending。必须为纯函数。

### P3-03 generateHorizonInline

严格执行 design §5.8A：

1. 只按传入 `version.id + slot_key='default'` 查询 slot；不得通过 `plans.current_version` 重新定位。
2. 缺 slot 抛 invariant error。
3. 使用 `familyDateRange()`、`toScheduledAt()` 和唯一 occurrence-key builder。
4. 对 `[from, through]` 闭区间生成；超过非空 `plan.end_date` 的日期跳过。
5. INSERT 必须填写 plan_id、plan_version_id、student_id、owner_id、family_date、slot_key=`default`、scheduled_at、status=`pending`、source=`plan`、occurrence_key、plan_snapshot=`NULL`。
6. `ON CONFLICT (occurrence_key) DO NOTHING`，返回实际新增数量。
7. 不写 `schedule_horizon_maintains`、audit 或 outbox。

### P3-04 createFormalPlan

- 授权后先查 `(owner_id,student_id,create_idempotency_key)`，再检查 active formal。
- 命中同 hash：200 语义回放，跳过 active 检查、horizon、persist、audit、outbox；异 hash：冲突。
- 同事务写 plans、v1、default slot，再更新 `plans.current_version`。
- body camelCase 仅在边界映射一次；领域快照为 snake_case。
- `from=max(start_date,toFamilyDate(now))`；`through=horizonThrough(createdPlan,now)`；范围有效时内联生成。
- 调用 persist expired；写 audit 与 `plan.created:{plan_id}` outbox。
- 内联路径不写 horizon-maintained。

### P3-05 editFormalPlan

- 先按 `(plan_id,create_idempotency_key)` 回放/冲突，再锁 plan。
- 保存 oldVersionId；localTime 未传时从 oldVersionId 的 default slot 读取。
- 即使 localTime 未变，也必须创建 vN+1 及其 slot 快照。
- 强制顺序：读 old slot → INSERT vN+1 → INSERT new slot → UPDATE current_version。
- `effective_from=nextFamilyDate(now)`。
- title/description/endDate/localTime 未传或 null 时按 design §5.2 的 `??` 语义保留。
- `effectiveEndDate` 与 `updatedPlan` 是取消、horizon、generate 的唯一输入。
- 缩短 endDate 时取消其后的 pending；取消旧 version 自 effective_from 起的 pending。
- 新 version 从 effective_from 生成至 `horizonThrough(updatedPlan,now)`；不得由 cancelled 行的全表 max 推动起点。
- persist expired；audit + `plan.version_created:{version_id}`；不写 horizon-maintained。

### P3-06 deactivateFormalPlan

- owner 授权；按 plan id + deactivate key/hash 回放或冲突。
- status→inactive；所有 future pending→cancelled；persist expired。
- audit + `plan.deactivated:{plan_id}`。
- 不生成日程、不写 horizon-maintain。

### P3-07 过期、结束日与 query

- `persistExpiredPastWindow` 只在写事务中更新指定 student 的 pending，并使用 `isPastCompletionWindow` 的语义；禁止简化为 `family_date < today`。
- `cancelPendingAfterEndDate`：end_date NULL 为 no-op；只取消 pending 且 `family_date>end_date`。
- query 返回持久 `status` 与纯计算 `effectiveStatus`；不得 UPDATE，不得调用 persist 或 maintain。

### P3-08 maintainHorizon

严格执行 design §5.8B：

1. scope 为 `(student_id,actor_id,idempotency_key)`。
2. 首次 SELECT 命中：同 hash 回放，异 hash 冲突；回放不 generate/audit/outbox/persist。
3. 锁 active formal plan，读取 `plans.current_version` 对应 version。
4. INSERT `items_created=0` placeholder，`ON CONFLICT DO NOTHING RETURNING`。
5. 未取得 placeholder 时重新 SELECT 并回放/冲突，不产生副作用。
6. 仅首个创建者先 persist expired，包括最终 no-op。
7. 已过 endDate → 0；否则 `from=max(当前 version 最远 pending+1,today)`；cancelled 或其他 version 不得推动 from。
8. `through=horizonThrough(plan,now)`；from>through → 0，否则调用 generateHorizonInline。
9. 更新 items_created；仅 items_created>0 写 audit + `schedule.horizon_maintained:{maintain_id}` outbox。
10. 并发同 scope/key 仅一个请求 generate/audit/outbox，其他回放。

### P3-09 complete / skip

共用 design §5.0 锁后顺序：

1. 服务层执行 actor/student/relationship 授权。
2. body hash；`SELECT schedule_item FOR UPDATE`。
3. 锁后查 `(schedule_item_id,idempotency_key)`：actor/hash/action 完全相同则回放；异 actor、异 hash、complete/skip 跨动作均冲突。
4. 无回放且 item 非 pending → 状态冲突。
5. 窗口外：persist expired 后抛窗口冲突；不得写 completed/skipped event。
6. complete：derive kind；写 completed event（reason NULL）、item completed、完整 fact_versions、audit、schedule.completed outbox；返回 event + fact。
7. skip：写 skipped event（kind NULL、reason 可空）、item skipped、audit、schedule.skipped outbox；不得写 fact/settlement/ledger；回放不得覆盖首次 reason。
8. 同 key 并发 complete×complete 或 skip×skip 后到者回放；complete×skip 冲突；只允许一条终态 event/fact。

### P3-10 Phase 4 seam

- 禁止实现 settlement、point rule、ledger、balance。
- complete 必须保留真实 Settlement domain seam，使 Phase 4 可在同一 transaction 内接入 `settleForFact`。
- 使用必要的依赖接口/回调注入；集成测试使用最小 spy。
- 不得创建空壳 settlement service、伪 ledger 或跨事务事件。
- Phase 3 回放只保证 event + fact；Phase 4 再扩展 ledger 回放。

## 5. 必须测试

单元：

- `tests/unit/schedule/occurrence-key.test.ts`
- `tests/unit/schedule/effective-status.test.ts`
- payload normalization/hash 聚焦测试

集成：

- `formal-plan.test.ts`
- `plan-end-date.test.ts`
- `maintain-horizon.test.ts`
- `schedule-generation.test.ts`
- `schedule-query.test.ts`
- `schedule-complete.test.ts`
- `schedule-skip.test.ts`
- `schedule-terminal-concurrency.test.ts`
- `schedule-auth.test.ts`
- `schedule-outbox.test.ts`
- `command-idempotency.test.ts`

覆盖 AC-M2-1/2/3/6/8 的 Schedule 部分，以及 F1–F3、F5–F24、F26–F28 的 Phase 3 部分；特别证明：

- create 回放先于 active 冲突；
- 三条生成路径的字段来源和指定 version slot 时间；
- 编辑缩短/扩展/未改 endDate，localTime 未变仍建 slot；
- maintain no-op 仍 persist，回放不 persist，并发单写；
- query 零 UPDATE；
- complete/skip 窗口、跨 actor、跨动作和并发矩阵；
- skip reason 持久化且回放不覆盖；
- Phase 3 无 settlement/ledger 写入。

## 6. 禁止项

- 不新增或修改 API Route。
- 不实现 Settlement、积分规则、ledger、balance。
- 不实现 Web、E2E。
- 不修改迁移或已签署 schema 契约。
- 不修改 M1 历史任务或 `.trellis` 文档。
- 不新建 command_log。
- 不复制 time-policy 算法。
- 不处理既有 lint warnings，不新增依赖。

## 7. 验证与提交

必须运行：

```bash
pnpm exec vitest run tests/unit/schedule tests/integration/schedule
pnpm exec vitest run tests/unit/time-policy tests/unit/training/time-policy.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check <executionBaseline>...HEAD
```

lint 允许基线已有 3 个 warning，但不得新增 warning/error。

提交一个聚焦 commit，建议：`feat(m2): implement schedule domain`。不得夹带 `.trellis` 或无关文件。

固定回报格式：

1. 完整 SHA；
2. 修改文件；
3. P3-01～P3-10 实现证据；
4. AC/F/R-ID → 测试名映射；
5. Settlement seam 签名与同事务保证；
6. 每条命令及原始结果；
7. 未执行项及原因；
8. 未解决 blocker，无则写“无”。

Cursor 不得宣称 Phase 3 GO；提交后等待 Codex 审核。
