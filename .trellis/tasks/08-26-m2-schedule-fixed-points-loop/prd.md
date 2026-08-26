# M2 计划与固定积分闭环 PRD

## 元信息

| 项 | 值 |
| --- | --- |
| 任务 ID | `m2-schedule-fixed-points-loop` |
| 基线分支 | `main` @ `42f25ea`（本任务规划修订在其上追加提交） |
| 前置里程碑 | M1（历史任务只读） |
| 门禁 | 负责人书面确认 prd + design + implement 后方可实现 |

## Goal

（同前）最小闭环 + 验收示例：每天 20:00 计划 → 完成 → 一条 +10 流水 → 刷新/重登/重复提交不重复记分。

## In Scope（审阅修订摘要）

### 日程生成（D3）

- **30 天滚动 horizon**：通过显式 **`POST maintain-horizon`**（家长、幂等）及创建/编辑计划事务内联维护扩展；**GET/列表绝不写库、不隐式触发生成**；无 Worker/cron。
- 创建/编辑时首次生成 30 天实例；日后由 maintain-horizon 滚动补齐。

### 完成窗口与迟完成（对齐 CONTEXT / data-model）

- 完成窗口：计划 `family_date` 当日至 **`family_date + 1` 家庭日结束**（Asia/Shanghai）。
- 窗口内**迟完成**允许；M2 固定模板 **`rewardsLateCompletion: true`**，仍 **+10**（与按时相同）；结算 explanation 区分 `on_time` / `late`。
- 超过窗口：`effectiveStatus=expired`（只读）；持久化 `expired` 仅于完成尝试（409）或维护命令事务。
- **未采用**「family_date 次日即过期」简化方案；与权威领域定义一致。

### 跳过（D6）

- `POST /api/schedule-items/[itemId]/skip`：学生或关联家长；可选原因；audit + outbox；**无正向积分**。
- 无跳过 UI；无跳过 E2E。

### 幂等（D5）

- 无 `command_log`；表级 `idempotency_key` + **`idempotency_payload_hash`**。
- **创建计划**：鉴权后**先**查 `(owner_id, student_id, key)`，再查 active plan 限制（见 design §5.1）。
- `schedule_events`：UNIQUE `(schedule_item_id, idempotency_key)` — complete/skip **同 key 409**。
- `fact_versions` 必含 `idempotency_key`（与完成 event 一致）。

### Time Policy

- 扩展 **`src/modules/time-policy/`**；不新建 `src/modules/time/`。

### E2E（AC-M2-7）

- **desktop-chromium** 与 **mobile-360（360×800）** 均独立执行完整链路：建正式计划 → 启用规则 → 学生完成 → 验证 +10、唯一 ledger、刷新/重登/重复提交不重复计分。

## Out of Scope

（同前；**移除**「迟完成奖励」— M2 窗口内迟完成已纳入；仍不做 18:00 扣分、补填配额、人工事实、Worker 等）

## Acceptance Criteria

### 必须

- [ ] **AC-M2-1** …（含 maintain-horizon 滚动）
- [ ] **AC-M2-3** fact_versions 含 idempotency_key
- [ ] **AC-M2-4** 按时与迟完成（窗口内）均 +10
- [ ] **AC-M2-7** desktop + mobile-360 **完整** E2E 链路（非仅查看积分）
- （AC-M2-2,5,6,8 同前）

### 失败路径

- [ ] **AC-M2-F5** GET 不写库
- [ ] **AC-M2-F6** effective expired 只读；窗口 = 计划日+1 日结束
- [ ] **AC-M2-F7** 窗口外 complete → persist expired + 409
- [ ] **AC-M2-F8** 维护事务批量 persist expired
- [ ] **AC-M2-F9** 创建：同 key 回放 200 **先于** active plan 检查；异 payload 409
- [ ] **AC-M2-F9b** 已有 active plan + **新 key** → 409；**同 key 回放** → 200
- [ ] **AC-M2-F10**–**F13** 幂等（含 payload hash）
- [ ] **AC-M2-F14** maintain-horizon 同键回放；GET 不触发
- [ ] **AC-M2-F15** 窗口内迟完成 +10；窗口外 409 无 ledger
- [ ] **AC-M2-F16** complete 后 skip 异键 409；complete/skip **同 key** 409
- [ ] **AC-M2-F17** skip API：家长/学生可用；无 ledger

## Notes

- 决策见 `design.md` §10；验收见 `research/m2-verification-matrix.md`。
- **无待负责人决策项**（迟完成已对齐权威定义）。
