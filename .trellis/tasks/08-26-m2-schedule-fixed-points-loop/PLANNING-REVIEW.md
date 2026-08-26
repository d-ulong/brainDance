# M2 规划复审 — 独立审阅入口

> **用途**：供 Codex 在 **`main`** 上审阅规划是否 **GO**（允许进入 `task.py start`）。
> **范围**：仅 `.trellis/tasks/08-26-m2-schedule-fixed-points-loop/`；**禁止**开始实现。
> **勿改**：`.trellis/tasks/08-25-m1-*` 历史任务。

> **Cursor 整改唯一来源**：当前存在阻断时，必须先阅读并仅按
> [`research/cursor-remediation.md`](research/cursor-remediation.md) 的 R-ID 修订；
> 旧 `planning-rereview-*.md` 仅保留审阅历史，不能作为整改范围依据。

## 审阅顺序（强制）

1. `research/planning-signoff-checklist.md` — 逐项 PASS/FAIL（全部 PASS 方可 GO）
2. `prd.md` — AC-M2-1~8、AC-M2-F1~F28
3. `design.md` — §4~§6、§5.0/§5.8、§4.9 outbox、§11 Web UI
4. `implement.md` — §2~§4、§6~§7
5. `research/m2-verification-matrix.md` — AC/F 与测试映射

## 审阅基线

```bash
git fetch origin
git log -1 --oneline   # 记录 HEAD SHA
git diff --check 9c9a1a6...HEAD -- .trellis/tasks/08-26-m2-schedule-fixed-points-loop
```

## GO 条件（全部满足）

| # | 条件 |
| --- | --- |
| G1 | `planning-signoff-checklist.md` 全部条目 PASS |
| G2 | 无「同前」「…」「见 design §x」类不可实施占位 |
| G3 | 首轮阻断 #1–#8（`planning-rereview-9c87d40.md`）均可追溯闭合 |
| G4 | `schedule_events` 幂等 scope 唯一：资源级 `(schedule_item_id, idempotency_key)`；跨 actor 同 key → 409 |
| G5 | 迟完成窗口 = 计划日 +1 家庭日结束（非次日即 expired 简化） |
| G6 | GET / mount 不触发 maintain；内联 horizon 不写 `schedule_horizon_maintains` |
| G7 | desktop + mobile-360 E2E 各完整 7 步（非 mobile 只看积分） |
| G8 | 仅规划文件变更；无 `task.py start`、无 feat/m2 分支 |

## NO-GO 时

在 Trellis `m2-planning-rereview` 发布 comment：**逐条**列出 FAIL 的 checklist ID + 文件 § + 建议修订；禁止笼统「仍有问题」。

## 放行记录

审阅完成后填写 `research/planning-signoff.md`（GO/NO-GO + SHA + 日期）。
