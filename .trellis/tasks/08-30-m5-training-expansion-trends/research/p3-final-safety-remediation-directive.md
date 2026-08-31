# M5 P3 最终安全整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定候选实现 SHA：`705ad71c23f4996661fdc6af0bbb574daa10f7d8`
>
> 整改性质：**三轮验收线审计后，仅处理新增生产级生命周期竞态；P3-R05、P3-R06 必须一次性关闭。**
>
> 结论：**NO-GO；只授权本文件的原子安全补丁，不授权归并或 M6。**

## 1. 固定验收线

本轮不重开 P3-R01～P3-R04，不追加风格或测试工具整改。仅以下两项可阻断，因为它们会让隐藏页面继续训练、遗漏 blur 事件或永久暂停，直接违反 R-M5-07、AC-M5-09 与 P3-R03 已冻结的不变量。

Stroop E2E 读取 `data-ink-color`、生命周期 hook 职责偏多、少量重复代码及 P1 race helper 诊断债均记录为**非阻断技术债**；不得顺手重构，也不得因此产生下一轮整改。

## 2. P3-R05 — 连续 visibility 变化丢失 blur 或错误恢复

- **依据**：R-M5-07、AC-M5-09、P3-R03“恢复期间保持暂停，blur 写入成功且当前可见后才恢复交互”。
- **位置**：`src/components/training/use-training-blur.ts` 及聚焦测试。
- **原因**：当前 `reportingRef` 会丢弃上报进行中的后续 blur；首个上报成功后又无条件 `setPaused(false)`。`hidden → visible（A 上报中）→ hidden → visible` 可使页面在仍隐藏时恢复，或使第二段 blur 被丢弃并永久暂停。
- **修订动作**：把 visibility interval 作为不可丢失的顺序状态处理；上报中的新 hidden/visible 必须合并或排队并最终准确写入。只有当前确实可见、没有待报告 interval、最近 blur 写入成功且未 abandoned 时才能解除暂停。失败/abandoned 后不得再恢复。
- **验证**：使用可控 deferred append 覆盖上述完整交错，断言每段 blur 均被计入、写入严格串行、隐藏期间始终 paused、最终仅在全部成功且可见时恢复；同时覆盖第二次上报失败与 abandoned。

## 3. P3-R06 — stimulus append 完成后使用陈旧暂停状态

- **依据**：R-M5-07、AC-M5-09、P3-R03“暂停期间不得展示或推进计时，恢复完成后才恢复交互”。
- **位置**：`digit-span/page.tsx`、`reaction/page.tsx`、`stroop/page.tsx` 及聚焦测试。
- **原因**：`await appendEvent(stimulus)` 后读取闭包中的旧 `lifecycle.paused/terminated`。若 append pending 时页面隐藏，Digit Span 会在暂停 effect 已执行后新建计时器，计时器回调也捕获旧状态；Reaction/Stroop 会直接开放响应。用户可能未看到刺激却能作答，或隐藏期间进入 response。
- **修订动作**：通过同步 current-state ref 或生命周期提供的当前门禁，在所有 post-await、timer callback 和 retry 恢复入口检查最新 `paused/terminated/error` 状态。Digit Span 隐藏时只保存剩余展示时长，不创建/推进 timer；Reaction/Stroop 隐藏时不得开放响应，成功恢复后才以明确且一致的方式展示/开放该 stimulus。不要复制三套互相漂移的临时状态机。
- **验证**：三项训练分别用 deferred stimulus append 覆盖“append pending 时 hidden，append 成功后仍 hidden，再 visible 并完成 blur 恢复”；断言隐藏期间无 timer 推进、无可交互 target、无 response event，恢复成功后才继续。另覆盖恢复失败/abandoned 时永不开放。

## 4. 允许范围与禁止项

仅允许修改关闭 P3-R05/R06 必需的 lifecycle/blur hook、三训练页、相应聚焦 unit/component tests，以及 `p3-implementation-record.md` 的整改状态和验证证据。

禁止修改服务端协议、schema/migration、P1/P2 指标与趋势、授权逻辑、依赖、规格或既有整改指令；禁止无关重构、merge、rebase、reset、push、deploy 或启动 M6。不要专门整改本文件列出的非阻断技术债。

## 5. 完成定义

1. P3-R05/R06 的 deterministic regression tests 必须先能证明旧实现失败、修复后通过。
2. 三训练正常路径、短失焦、累计超 30 秒、恢复失败、事件重试与 submit 重试不得回退。
3. 只创建一个聚焦 commit，并更新实施记录；不得夹带非授权文件。

```bash
pnpm test tests/unit/training/training-event-queue.test.ts <本轮新增的聚焦测试文件>
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

数据库与 E2E 在无其他 runner 条件下串行执行。P3 聚焦测试、typecheck、build、desktop/mobile M5 E2E 必须退出 0；全量测试仅既已登记的 P1 helper 诊断债可单列非阻断。

## 6. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整整改 SHA>
execution_base: <包含本指令的完整 SHA>
status: M5 P3 最终安全整改已交 Codex 复验（非 GO、未归并）

resolved:
- P3-R05: <连续 visibility 交错的实现与 deterministic test 证据>
- P3-R06: <三训练 deferred stimulus + hidden 的实现与 test 证据>

changed_files:
- <文件>

verification_raw_summary:
- <命令>: <退出码与原始摘要>

e2e_matrix:
- desktop Chromium: <M5 用例数与结果>
- mobile-360: <M5 用例数与结果>

nonblocking_debt:
- <保持未改的既有技术债>

blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P3 最终安全整改已交 Codex 复验，未归并、未启动 M6。”**
