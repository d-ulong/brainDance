# M2 规划 Signoff Checklist

> Codex 复审：每项标 PASS/FAIL。全部 PASS → GO。

## A. 首轮阻断 #1–#8（9c87d40）

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| A1 | prd AC-M2-1~8、F1~F21 完整无占位 | `prd.md` §Acceptance Criteria |
| A2 | implement §5 M1 衔接、§6 检查清单、§7 禁止项 | `implement.md` |
| A3 | schedule_events 资源级幂等；跨 actor 409 | `design.md` §4.3、§5.7 |
| A4 | 编辑从 effective_from 生成至 today+30 | `design.md` §5.2、§5.8A |
| A5 | skip 窗口外 persist expired + 409 | `design.md` §5.4b；prd F18 |
| A6 | completion_kind 必填列（非 optional metadata） | `design.md` §4.4 |
| A7 | 内联不写 horizon_maintains；create 回放无二次维护 | `design.md` §5.8A；F21 |
| A8 | 仅显式按钮 maintain；无 horizonDays 参数 | `design.md` §5.8B/C；NF-7 |
| A9 | git diff --check 通过 | NF-8 |

## B. 自包含性（无省略）

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| B1 | design §5.3/5.5/5.6 完整步骤 | `design.md` |
| B2 | design §5.7 全表含跨 actor 列 | `design.md` §5.7 |
| B3 | 无 `...` SQL/路径占位 | `design.md` §5.4–5.5 |
| B4 | implement §3 完整 route/service 列表 | `implement.md` §3 |
| B5 | prd 无「见 design §x」 | `prd.md` |

## C. 冻结规格

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| C1 | occurrence_key 格式冻结 | `design.md` §4.6 |
| C2 | plan_schedule_slots `(plan_version_id, slot_key)` | `design.md` §4.2 |
| C3 | schedule_items 状态机 | `design.md` §4.7 |
| C4 | persistExpired 用 isPastCompletionWindow | `design.md` §4.8 |
| C5 | outbox 事件 + dedupe_key 表 | `design.md` §4.9 |
| C6 | settlement_period = family_date | `design.md` §5.5 |
| C7 | ledger idempotency_key UNIQUE | `design.md` §4.2 |
| C8 | generateHorizonInline 算法 | `design.md` §5.8A |
| C9 | complete/skip 决策顺序 §5.0 | `design.md` §5.0、§5.4、§5.4b |
| C10 | Web UI 路径与 maintain 按钮 | `design.md` §11；implement §3 |

## D. 验收可追溯

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| D1 | F1–F21 均在 design §6.1 或矩阵 | `design.md` §6.1；`m2-verification-matrix.md` §3 |
| D2 | AC-M2-1~8 均有测试映射 | `design.md` §10；`implement.md` §4.2 |
| D3 | E2E desktop + mobile-360 各 7 步 | `implement.md` §4.3；prd AC-M2-7 |
| D4 | time-policy 扩展非新建 time/ | `design.md` §8；implement §7 |

## E. 门禁

| ID | 要求 |
| --- | --- |
| E1 | 未 `task.py start` |
| E2 | 无 M2 业务代码/迁移 |
| E3 | 负责人书面批准前三文档后方可实现 |
