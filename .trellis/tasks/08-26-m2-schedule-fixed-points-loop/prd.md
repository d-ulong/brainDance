# M2 计划与固定积分闭环 PRD

## 元信息

| 项 | 值 |
| --- | --- |
| 任务 ID | `m2-schedule-fixed-points-loop` |
| 基线分支 | `main`（含已签署 M1，`feba95e` 及合并提交 `8c35b11`） |
| 前置里程碑 | M1 身份与单家庭训练（**历史任务只读，不改写**） |
| 性质 | 新纵向切片（M2），非 M1 修复 |
| 门禁 | 负责人书面确认本 PRD + `design.md` + `implement.md` 后方可写业务代码、迁移或 API |

## Goal

交付 M2 最小可演示闭环：**一名已关联家长**为**一名学生**创建并维护**一份正式计划**（固定每日时间点，如 20:00，`Asia/Shanghai`）；系统生成**稳定、不重复**的日程实例；学生标记完成后产生**不可覆盖的系统完成事实**；基于**固定积分模板**生成**唯一、可解释**的积分流水；**余额由流水推导**；重复提交、重复生成、重复结算均不产生重复事实或积分。

**验收示例（必须纳入）**：家长建立「每天 20:00 完成作业」的正式计划 → 学生完成后 → **只生成一条**可解释的积分流水 → 刷新、重登、重复提交均不重复记分。

## Background

- 权威术语：`CONTEXT.md`；持久化模型：`docs/data-model.md`；Module 边界：`docs/architecture.md`；路线图 M2：`docs/implementation-roadmap.md`。
- M1 已交付：Identity、Family Access、Training（反应力）、最小审计、事务 outbox **占位写入**（`pending`，无 Worker）。
- M2 是路线图第二个纵向切片；**不得**在未合并 M1 的 `main` 上并行开始本任务实现（规划除外）。

## In Scope

### P1 — 正式计划（单学生 · 单计划 · 单时间点）

- 已验证家长为**已关联的一名学生**创建**一份**正式计划（`plan_kind=formal`）。
- M2 限制：**每名学生同时最多一份 `active` 正式计划**；创建第二份须先停用或拒绝。
- 计划字段（M2 最小集）：标题、说明（可选）、每日频率、**一个**本地时间点（如 `20:00`）、生效开始日期、可选结束日期。
- 家长（计划 `owner_id`）可编辑计划规则；编辑产生**新 plan_version**，**从次日起**按 `CONTEXT.md`「计划前瞻重建」生效；当天及历史实例不变。
- 家长可停用计划：停止生成新实例；未来未完成实例标为 `cancelled`（不物理删除）。
- 所有计划本地日期/时间按固定家庭时区 `Asia/Shanghai` 解释；M2 不提供时区修改。

### P1 — 日程实例生成

- 由 Schedule Module **幂等**生成未来日程实例（**30 天**滚动 horizon，D3 已批准）。
- 每个实例具有稳定 `occurrence_key = (plan_id, plan_version_id, family_date, slot_key)`；数据库 **UNIQUE**。
- 重试、监督器重建、计划版本变更**不得**制造重复实例；变更仅撤销/取消未来未完成实例并按新键重建。
- M2 每计划每日**仅一个** `slot_key`（单时间点）；不支持同日多实例（延后至后续里程碑）。
- 实例状态：`pending → completed | skipped | expired | cancelled`（M2 E2E 主路径至少覆盖 `pending → completed`；跳过仅 API+集成测试，**E2E 不要求跳过 UI**；过期见下方 D4 语义）。
- **过期语义（D4，已批准）**：
  - **禁止** GET/列表读取写数据库。
  - 列表/详情可返回 **effective status**：库内仍为 `pending` 时，若已逾业务过期窗口则对外展示为 `expired`（只读计算，不落库）。
  - **持久化** `pending → expired` **仅允许**在：(a) 学生尝试完成已逾期的日程时（同事务先持久化 expired 再拒绝完成），或 (b) 显式生成/维护命令的事务中（创建计划、编辑版本、停用、滚动生成实例时批量标记过去 pending）。

### P1 — 完成事实（系统事实）

- 学生（且仅关联学生本人）可将 `pending` 日程标记为完成。
- 完成产生**追加型** `fact_versions`（`source_kind=system`，如 `schedule.completed_at`）；**禁止 UPDATE 覆盖**已有事实。
- 记录 `occurred_at`（实际完成时刻，UTC）、`family_date`（业务日期）、操作者与 `idempotency_key`。
- 重复完成请求（相同幂等键）回放同一结果；不同键对已完成实例返回冲突且不产生新事实。

### P1 — 固定积分模板与结算

- 管理员维护（或迁移/种子预置）**一条** M2 固定模板：事件类型为「正式计划日程系统完成」，固定分值 **+10 分/次**（D2，已批准）。
- 家长为关联学生**启用**该模板实例（`point_rules` + `point_rule_versions`）；M2 每学生仅一条 active 规则即可。
- 结算**仅消费系统完成事实**（M2 不引入人工事实确认流程）。
- 同一 `(fact_version_id, rule_version_id, settlement_period)` **唯一** settlement；奖扣互斥，M2 仅正向奖励。
- 生成**不可变** `point_ledger_entries`，含 `reason`/`explanation` 可追溯到计划、日程实例与规则版本。
- `point_balance_projection` **仅由流水增量更新或重建**；禁止直接 UPDATE 余额作为权威写入路径。

### P1 — 幂等、事务、审计与 Outbox

- 所有写命令接受 `Idempotency-Key`（或等价请求体字段），数据库唯一约束为最终防线。
- 完成 + 结算 + 流水 + 余额投影 + 审计 + outbox **同一数据库事务**（D1 已批准：同步 inline 结算；M2 **无 Worker**，outbox 保持 `pending`）。
- 必须审计：计划创建/编辑/停用、日程完成、结算、流水创建（类型化、脱敏 metadata）。
- Outbox 事件至少覆盖：计划版本变更、日程完成、积分结算（dedupe_key 与命令幂等对齐）。

### P1 — 最小 Web 与验收视口

- **家长路径**：查看已关联学生 → 创建/编辑/停用正式计划 → **独立步骤启用积分规则（D8）** → 查看今日/近日日程与积分余额。
- **学生路径**：查看今日待做日程 → 标记完成 → 查看积分变化。
- M2 正式计划**不绑定 goal**（D7）；跳过日程仅 API+集成测试，无跳过 UI（D6）。
- 桌面 Chromium 与 **360×800** 移动端均可完成上述主路径；不得仅靠 API 测试替代浏览器验收。

### P2 — 建议（不阻断 M2 归档，implement 计划包含）

- 计划编辑「次日起生效」的集成测试与 E2E 断言。
- 停用计划后未来实例 `cancelled` 的可视化确认。
- 监督器模式 E2E（沿用 M1 `run-e2e.mts` 模式）。

## Out of Scope（M2 明确不做）

| 能力 | 说明 / 目标 |
| --- | --- |
| Outbox Worker、死信、投影重建 CLI | M3；M2 只写入 `pending` outbox |
| 人工事实确认、错误数/质量事实、事实更正与积分冲销 | M3 |
| 多家长、多学生家庭 UI、私密总结、授权纪元扩展场景 | M4+ |
| Stroop、数字广度、训练趋势 UI | M5 |
| 管理员 TOTP | M3 / 上线前专项（仍为生产阻断项） |
| 13–18 岁路径 B 自助注册 | M1 延期项 |
| 个人计划创建、转化正式计划 | M2 可选延后；**不纳入 M2 最小闭环** |
| 手动日程、多实例/日、迟完成奖励、18:00 扣分、补填配额 | 后续里程碑 |
| 兑换、手动奖励、负余额、规则叠加 | M3/M6 |
| 站内通知中心业务推送 | 后续 |

**不得**改写 `.trellis/tasks/08-25-m1-identity-training-loop/` 与 `.trellis/tasks/08-25-m1-verification-remediation/` 内任何文件。

## Assumptions

- M2 默认演示家庭：M1 E2E 已覆盖的单家长 + 单学生 + 受控学生路径 A。
- 固定模板分值与模板 ID 由 seed + migration 预置；家长 UI 仅「启用/调整允许范围内参数（M2 可仅启用默认分值）」。
- 结算在请求事务内**同步 inline** 完成（D1）；固定模板 +10 分/次（D2）。
- 过期：**列表只读计算 effective expired**；持久化 expired 仅于完成尝试或维护命令事务（D4）；见 `design.md` §过期与 `design.md` §幂等。
- 幂等：**不新增**泛化 `command_log` / `command_idempotency` 表（D5）；复用 M1 表级 `idempotency_key` + actor/scope UNIQUE；见 `design.md` §5 与 §5.7。

## Acceptance Criteria

### 必须（路线图 M2 + 验收示例）

- [ ] **AC-M2-1 单计划单时间点**：家长创建「每天 20:00 完成作业」正式计划；未来 30 天内生成正确 `family_date` 与 `scheduled_at` 的实例；`Asia/Shanghai` 边界日测试通过。
- [ ] **AC-M2-2 occurrence_key 稳定**：相同 `(plan_id, plan_version, family_date, slot_key)` 重复生成 0 行新增；DB UNIQUE 拒绝重复。
- [ ] **AC-M2-3 完成事实不可覆盖**：学生完成后存在 `fact_versions`；重复 POST（同 Idempotency-Key）回放；异键重复提交不产生第二条事实或第二条流水。
- [ ] **AC-M2-4 唯一可解释流水**：每次有效完成仅一条 settlement + 一条正向 ledger；ledger 可追溯到 schedule_item、plan、rule_version。
- [ ] **AC-M2-5 余额来自流水**：余额等于 ledger 求和；刷新/重登后一致；禁止存在「仅改 projection 不改 ledger」的代码路径。
- [ ] **AC-M2-6 计划变更边界**：编辑时间后，当天实例不变；次日起实例按新版本键重建；无重复 future 实例。
- [ ] **AC-M2-7 浏览器主路径**：desktop + mobile-360 E2E 跑通「建计划 → 完成 → 看积分」；含硬刷新与重复提交不断档。
- [ ] **AC-M2-8 审计与 outbox**：上述写操作在同事务写 audit + outbox；集成测试断言 dedupe_key 唯一。

### 失败路径（必须测试）

- [ ] **AC-M2-F1** 未关联家长/学生不能创建计划或完成他人日程（403）。
- [ ] **AC-M2-F2** 停用计划后不再生成新实例；已有 future pending → cancelled。
- [ ] **AC-M2-F3** 已完成日程再次完成（异键）→ 409/冲突，无新流水。
- [ ] **AC-M2-F4** 结算重试（同幂等键）→ 同一 ledger 回放，余额不叠加。
- [ ] **AC-M2-F5** GET 日程列表**不写库**；多次读取后 DB `status` 仍为 `pending`（未触发维护/完成命令时）。
- [ ] **AC-M2-F6** 列表对逾期待办返回 **effectiveStatus=expired**；库内仍为 `pending` 直至维护或完成尝试。
- [ ] **AC-M2-F7** 学生尝试完成已逾期日程 → 事务内持久化 `expired`（若仍为 pending）→ **409**；无 fact/settlement/ledger。
- [ ] **AC-M2-F8** 创建/编辑/停用/滚动生成事务 → 对过去 `pending` 批量持久化 `expired`（与生成同事务）。
- [ ] **AC-M2-F9** 创建计划同 scope 同键重放 → 200 + 同一 `plan_id`；异 payload 同键 → 409。
- [ ] **AC-M2-F10** 编辑版本 / 停用 / 启用规则：同 §5.7 重放与冲突行为。
- [ ] **AC-M2-F11** 完成日程同 `(schedule_item_id, key)` 重放 → 200；已完成后异键 → 409（AC-M2-F3）。
- [ ] **AC-M2-F12** 同一 key 用于**不同 student_id** 的创建计划 → 各自独立成功（scope 不同）。
- [ ] **AC-M2-F13** 同一 key 用于**不同命令类型**（如 create-plan vs enable-rule）→ **允许**（无全局 command 表；各表 scope 独立）。

## Non-Functional

- 写操作携带幂等键；敏感读取实时校验 `relationships.status=active` 与 `authorization_epoch`（沿用 M1）。
- 360px 无横向滚动（与 M1 标准一致）。
- 迁移 expand-only；回滚策略见 `implement.md`。
- 不新增第三方依赖，除非 design 中经负责人批准的时区/日期库必要性论证。

## Notes

- 实现分支建议：`feat/m2-schedule-fixed-points-loop`（implement 阶段创建，规划阶段不建分支）。
- 已批准决策见 `design.md` §10（D1–D8，2026-08-26）。
- 风险与 deferrals 见 `research/m2-known-risks.md`；验收矩阵见 `research/m2-verification-matrix.md`。
