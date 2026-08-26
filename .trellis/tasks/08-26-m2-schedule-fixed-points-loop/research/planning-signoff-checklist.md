# M2 规划 Signoff Checklist

> Codex 复审：每项标 PASS/FAIL。全部 PASS → GO。

## 标准轴

| ID | 要求 | 闭合位置 | 测试 |
| --- | --- | --- | --- |
| C4 | 迁移与 `docs/data-model.md` §4–§5 对齐；§2.0.7 禁止漂移；`point_rules.active` | `design.md` §4.2；`implement.md` §2.0–§2.0.7 | `m2-schema-constraints.test.ts` |

## 规格轴

| ID | 要求 | 闭合位置 | 测试 |
| --- | --- | --- | --- |
| C1 | occurrence_key 格式冻结 | `design.md` §4.6 | `occurrence-key.test.ts` |
| C2 | plan_schedule_slots 每 version 快照 | `design.md` §4.2、§5.2 | F27 |
| C3 | schedule_items 状态机 | `design.md` §4.7 | F3/F16/F17 |
| C4 | persistExpired 用 isPastCompletionWindow | `design.md` §4.8 | F6/F7/F8 |
| C5 | outbox 事件 + dedupe_key 表 | `design.md` §4.9 | F21 |
| C6 | settlement_period = family_date | `design.md` §4.2、§5.5 | F4 |
| C7 | ledger UNIQUE 仅 settlement_id | `design.md` §4.2、§5.5 | F25 |
| C8 | generateHorizonInline + horizonThrough | `design.md` §5.8A；`implement.md` §3/§4.1 | `horizon-through.test.ts` + F22 |
| C9 | balance UPSERT：`INSERT(balance)` + `EXCLUDED.balance`；仅 ledger RETURNING 后 | `design.md` §5.5；`implement.md` §2.0.4 | F25 |
| C10 | F26 maintain 并发；F27 slot 快照 | `implement.md` §4.2.1；矩阵 §3 | F26/F27 |
| C11 | maintain §5.8B：hash 回放 + INSERT 占位 + 冲突读取；no-op 仍 persistExpired | `design.md` §5.8B | F14/F26/F28 |
| C12 | §5.2 每 version 无条件 slot；localTime 未变复制 | `design.md` §5.2 | F27 |

## A. 首轮阻断 #1–#8（9c87d40）

| ID | 要求 | 闭合位置 |
| --- | --- | --- |
| A1 | prd AC-M2-1~8、F1~F28 完整无占位 | `prd.md` §Acceptance Criteria |
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
| D1 | F1–F28 均在 design §6.1 或矩阵 | `design.md` §6.1；`m2-verification-matrix.md` §3 |
| D2 | AC-M2-1~8 均有测试映射 | `design.md` §10；`implement.md` §4.2 |
| D3 | E2E desktop + mobile-360 各 7 步 | `implement.md` §4.3；prd AC-M2-7 |
| D4 | time-policy 扩展非新建 time/ | `design.md` §8；implement §7 |

## E. 门禁

| ID | 要求 |
| --- | --- |
| E1 | 未 `task.py start` |
| E2 | 无 M2 业务代码/迁移 |
| E3 | 负责人书面批准前三文档后方可实现 |
