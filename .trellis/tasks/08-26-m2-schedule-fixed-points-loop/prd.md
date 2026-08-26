# M2 计划与固定积分闭环 PRD

## 元信息

| 项 | 值 |
| --- | --- |
| 任务 ID | `m2-schedule-fixed-points-loop` |
| 基线 | `main` @ `ee79298`（本轮修订闭合 ee79298 复审缺口） |
| 前置 | M1 已签署（历史任务只读） |
| 门禁 | 书面确认 prd + design + implement 后方可实现 |

## Goal

交付 M2 最小闭环：一名已关联家长为一名学生创建并维护**一份**正式计划（如每天 20:00，`Asia/Shanghai`）；系统生成稳定日程实例；学生完成后产生不可覆盖的系统完成事实；固定模板产生唯一 +10 积分流水；余额由流水推导；重试不重复事实或积分。

**验收示例**：家长建立「每天 20:00 完成作业」→ 启用规则 → 学生完成 → **一条 +10 流水** → 刷新/重登/重复提交不重复记分。

## Background

- 术语：`CONTEXT.md`；模型：`docs/data-model.md`；架构：`docs/architecture.md`；路线图 M2。
- M1 已交付 Identity、Family Access、Training、审计、outbox 占位（pending，无 Worker）。

## In Scope

### 正式计划

- 家长为已关联学生创建一份 `formal` 计划；每学生同时 ≤1 `active` formal。
- 字段：标题、说明（可选）、每日频率、单时间点（如 20:00）、开始/可选结束日期；**不绑定 goal**（D7）。
- 家长可编辑（新 plan_version，次日起生效）或停用（future pending → cancelled）。

### 日程生成（D3）

- 固定 **30 天** horizon（无客户端参数）。
- **内联生成**：创建/编辑计划事务内 `generateHorizonInline`（不写 `schedule_horizon_maintains`）。
- **独立命令**：`POST maintain-horizon`，仅家长、显式 **「补齐日程」按钮** 触发（**禁止** mount 自动 POST；**禁止** GET 触发）。
- `occurrence_key` UNIQUE；编辑后从 **`effective_from` 至 today+30** 为**当前 version** 生成（见 design §5.2）。

### 完成窗口与迟完成

- 窗口：计划 `family_date` 至 **`family_date + 1` 家庭日结束**（对齐 CONTEXT / data-model）。
- 窗口内迟完成允许；模板 `rewardsLateCompletion: true`，**+10**。
- `completion_kind`（`on_time` \| `late`）为 **必填** 字段（event + fact），非可选 metadata。
- 超窗口：`effectiveStatus=expired`（只读）；持久化 expired 于 complete/skip 尝试或维护事务。

### 跳过（D6）

- `POST .../skip`：学生或关联家长；窗口外 **同 complete**（persist expired → 409）；无积分；无 skip UI/E2E。

### 幂等（D5）

- 无 `command_log`；表级 `idempotency_key` + `idempotency_payload_hash`。
- 创建：鉴权后**先**幂等查 `(owner_id, student_id, key)`，**再** active plan 检查；**回放不二次维护/audit/outbox**。
- `schedule_events`：UNIQUE `(schedule_item_id, idempotency_key)`；**资源级 scope** — 跨 actor 同 key **409**，不回放他人结果。

### 结算（D1/D2/D8）

- inline 同事务：fact → settlement → ledger → balance → audit → outbox。
- 固定模板 +10；家长 **独立步骤** 启用规则。

### Web 与 E2E

- 家长：计划 CRUD、「补齐日程」按钮、启规则、查看日程/积分。
- 学生：日程列表、完成。
- **desktop-chromium** 与 **mobile-360（360×800）** 各执行 **完整** E2E 链路（非 mobile 只看积分）。

## Out of Scope

Outbox Worker、死信、投影重建 CLI、人工事实确认/冲销、多家长 UI、Stroop/趋势、TOTP、路径 B、个人计划转化、手动日程、18:00 扣分/补填配额、兑换、手动奖励、站内业务推送。

不得改写 M1 历史任务目录。

## Acceptance Criteria

### 必须

- [ ] **AC-M2-1**：家长创建「每天 20:00 完成作业」；自 `max(startDate,today)` 至 today+30 生成正确实例；`maintain-horizon` 可滚动扩展；Asia/Shanghai 边界测试通过。
- [ ] **AC-M2-2**：相同 `occurrence_key` 重复生成 0 新增；DB UNIQUE 拒绝重复。
- [ ] **AC-M2-3**：完成后 `fact_versions` 含 `idempotency_key`、`completion_kind`、`occurred_at`；同键回放；异键已完成 → 409。
- [ ] **AC-M2-4**：每次有效 complete 仅 1 settlement + 1 正向 ledger（+10）；explanation 含 `completion_kind`；on_time 与 late 均 +10。
- [ ] **AC-M2-5**：`point_balance_projection.balance` = ledger 求和；刷新/重登一致；无 bypass ledger 写余额路径。
- [ ] **AC-M2-6**：编辑时间后当天实例不变；自 `effective_from` 起为新 version 生成实例至 today+30；无重复 future 实例。
- [ ] **AC-M2-7**：desktop + mobile-360 **各**跑通：建计划 → 启规则 → 完成 → +10 → 刷新/重登/同键重复 complete 仍 1 ledger。
- [ ] **AC-M2-8**：写操作同事务 audit + outbox；dedupe_key 唯一；create 回放不重复 outbox。

### 失败路径

- [ ] **AC-M2-F1**：未授权创建/完成/跳过 → 403。
- [ ] **AC-M2-F2**：停用后无新实例；future pending → cancelled。
- [ ] **AC-M2-F3**：已完成异键 complete → 409；无新 ledger。
- [ ] **AC-M2-F4**：结算同键重试 → 同一 ledger；余额不变。
- [ ] **AC-M2-F5**：GET 列表多次 → DB 无 UPDATE。
- [ ] **AC-M2-F6**：列表 effective expired 只读；窗口 = 计划日+1 日结束。
- [ ] **AC-M2-F7**：窗口外 complete → persist expired + 409。
- [ ] **AC-M2-F8**：维护/创建/编辑事务批量 persist expired。
- [ ] **AC-M2-F9**：创建同 scope 同键同 payload → 200 回放；异 payload → 409。
- [ ] **AC-M2-F9b**：已有 active plan + 新 key → 409；同 key 回放 → 200（不触发 active 冲突）。
- [ ] **AC-M2-F10**：编辑/停用/启规则 payload hash 行为符合 design §5.7。
- [ ] **AC-M2-F11**：complete 同键回放含 ledger。
- [ ] **AC-M2-F12**：同 key 不同 student 创建 → 各自成功。
- [ ] **AC-M2-F13**：同 key 跨命令类型（create vs enable-rule）→ 允许。
- [ ] **AC-M2-F14**：maintain-horizon 同键回放；GET/mount **不**触发。
- [ ] **AC-M2-F15**：窗口内 late +10；窗口外 complete 无 ledger。
- [ ] **AC-M2-F16**：complete/skip 同 key → 409；complete 后 skip 异键 → 409。
- [ ] **AC-M2-F17**：skip 无 ledger；家长/学生可 skip（窗口内）。
- [ ] **AC-M2-F18**：窗口外 skip → persist expired + 409（不得 skipped）。
- [ ] **AC-M2-F19**：编辑后新版本自 effective_from 有实例（不因 cancelled max 日期跳过生成）。
- [ ] **AC-M2-F20**：同 item 同 key、异 actor（complete vs skip）→ 409，不回放。
- [ ] **AC-M2-F21**：创建计划幂等回放 → 无第二次 inline horizon、无重复 plan.created outbox。

## Non-Functional

- 写操作 Idempotency-Key；授权 realtime；360px 无横向滚动；迁移 expand-only；扩展 `src/modules/time-policy/`。

## Notes

- 设计细节：`design.md`；实施：`implement.md`；矩阵：`research/m2-verification-matrix.md`。
- 复审报告：`research/planning-rereview-9c87d40.md`（首轮）；`research/planning-rereview-ee79298.md`（ee79298 复审缺口）。
