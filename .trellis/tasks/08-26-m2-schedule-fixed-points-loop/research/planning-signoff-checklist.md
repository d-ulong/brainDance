# M2 规划 Signoff Checklist

> Codex 复审：每项标 PASS/FAIL。全部 PASS → GO。

## 标准轴（7804743 复审项）

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| C4 | implement §2 逐表可执行迁移；与 design §4.2 + §2.0.6 交叉表一致 | `implement.md` §2.0–§2.0.6 |
| C6 | horizonThrough=min(endDate,today+30)；缩短 endDate 取消 pending；maintain 已结束 no-op 且无 horizon_maintained outbox | `design.md` §4.8b、§5.1/§5.2/§5.8B；F22 |

## 规格轴（冻结规格 C 节）

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| C1 | occurrence_key 格式冻结 | `design.md` §4.6 |
| C2 | plan_schedule_slots `(plan_version_id, slot_key)` | `design.md` §4.2 |
| C3 | schedule_items 状态机 | `design.md` §4.7 |
| C4 | persistExpired 用 isPastCompletionWindow | `design.md` §4.8 |
| C5 | outbox 事件 + dedupe_key 表 | `design.md` §4.9 |
| C6 | settlement_period = family_date | `design.md` §4.2、§5.5 |
| C7 | ledger UNIQUE 仅 settlement_id；无全局 idempotency UNIQUE | `design.md` §4.2、§5.5 |
| C8 | generateHorizonInline + horizonThrough 算法 | `design.md` §5.8A；`time-policy/horizon-through.ts` |
| C9 | complete/skip 决策顺序 §5.0 | `design.md` §5.0、§5.4、§5.4b |
| C10 | Web UI 路径与 maintain 按钮 | `design.md` §11；implement §3 |
| C11 | horizonThrough / add-family-days 冻结于 time-policy | `design.md` §5.8A、§8；implement §3 |
| C12 | balance 仅 ledger INSERT RETURNING 时 UPSERT；冲突回放不累加 | `design.md` §5.5；implement §2.0.4；F25 |

## A. 首轮阻断 #1–#8（9c87d40）

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| A1 | prd AC-M2-1~8、F1~F25 完整无占位 | `prd.md` §Acceptance Criteria |
| A2 | implement §5 M1 衔接、§6 检查清单、§7 禁止项 | `implement.md` |
| A3 | schedule_events 资源级幂等；跨 actor 409 | `design.md` §4.3、§5.7 |
| A4 | 编辑从 effective_from 生成至 horizonThrough | `design.md` §5.2、§5.8A |
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

## D. 验收可追溯

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| D1 | F1–F25 均在 design §6.1 或矩阵 | `design.md` §6.1；`m2-verification-matrix.md` §3 |
| D2 | AC-M2-1~8 均有测试映射 | `design.md` §10；`implement.md` §4.2 |
| D3 | E2E desktop + mobile-360 各 7 步 | `implement.md` §4.3；prd AC-M2-7 |
| D4 | time-policy 扩展非新建 time/ | `design.md` §8；implement §7 |

## E. 门禁

| ID | 要求 |
| --- | --- |
| E1 | 未 `task.py start` |
| E2 | 无 M2 业务代码/迁移 |
| E3 | 负责人书面批准前三文档后方可实现 |
