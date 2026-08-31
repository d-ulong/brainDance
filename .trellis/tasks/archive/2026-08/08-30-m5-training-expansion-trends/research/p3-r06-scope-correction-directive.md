# M5 P3-R06 范围合规纠偏 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 分支：`feat/m5-training-expansion-trends`
>
> 固定执行基线 SHA：`<本指令提交后的完整 SHA，以 Codex 交接回报为准>`
>
> 固定待复验实现 SHA：`6d2b7b2f330f17a18d2d7d369c045c4c69a8c584`
>
> 状态：**NO-GO；只纠正 P3-R06-S1，不新增产品验收项，禁止归并或启动 M6。**

## 1. 验收线审计

P3-R06-C1/C2 的生产实现和真实生命周期证据在固定 SHA 上通过聚焦复验：

- `pnpm test tests/unit/training/p3-r06-lifecycle.test.tsx`：5/5 通过；
- coordinator/event queue：10/10 通过；
- `pnpm typecheck`：通过；
- `pnpm lint`：0 error（已有 warning 另记非阻断债务）。

本轮不再改变 C1/C2 的产品验收线。唯一阻断是上一冻结指令“不得修改依赖”的明确范围硬约束被违反，符合工程规范允许追加阻断项的条件。

## 2. P3-R06-S1 — 移除未授权测试依赖与全局测试配置扩张

- **依据**：`p3-r06-final-correction-directive.md`“不得修改……依赖”；AGENTS.md §2、§3 的最小充分方案与聚焦变更要求。
- **现状**：`6d2b7b2...` 新增 `@testing-library/react`、`happy-dom`，扩张 `pnpm-lock.yaml`，并为单个整改测试修改全局 `vitest.config.ts`。`p3-implementation-record.md` 同时将 blocker 写为 none。
- **修订**：
  1. 撤销本阶段对 `package.json`、`pnpm-lock.yaml` 和全局 `vitest.config.ts` 的新增依赖/配置变更；不得升级或新增其他依赖。
  2. 保留已通过的 C1/C2 生产修复。使用仓库已安装能力重写真实生命周期证据；优先扩展现有 Playwright P3 流程或使用现有 Vitest/React/ReactDOM 能力，不得退回只测纯 helper。
  3. 证据必须仍覆盖：visibility 事件后 rerender 前 deferred append 不开放；初始 hidden 同步；failure/abandoned 永不开放；Digit Span timer 在 hidden/pause-effect 竞态下不推进且恢复恰好一次。
  4. 修复本次修改在 `digit-span/page.tsx` 引入的 `react-hooks/exhaustive-deps` warning；不得用 eslint-disable 压制。
  5. 更新 `p3-implementation-record.md`，准确记录 P3-R06-S1、最终证据位置和全部命令原始摘要；提交前不得预写未知 HEAD。

## 3. 允许范围与禁止项

允许修改：关闭 P3-R06-S1 所需的上述三个依赖/配置文件、P3-R06 真实回归测试、`digit-span/page.tsx` 的 effect 依赖，以及 `p3-implementation-record.md`。

禁止修改：其他生产业务逻辑、服务端、schema/migration、P1/P2、已通过的 P3-R05 coordinator 语义、PRD/design/implement/task status、依赖版本、E2E 答案 helper；禁止 merge/rebase/reset/push/deploy/归档或启动 M6。

## 4. 完成定义与验证

```bash
pnpm test <P3-R06 使用现有依赖实现的聚焦测试；若证据迁至 Playwright，则运行对应 spec/project>
pnpm test tests/unit/training/training-blur-coordinator.test.ts tests/unit/training/training-event-queue.test.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

P3-R06 聚焦证据、typecheck、build 和双视口 M5 E2E 必须退出 0；仅已登记的 P1 advisory-lock helper 诊断债可如实列为非阻断。`pnpm lint` 不得再报告本阶段引入的 `digit-span/page.tsx` warning。

只提交一个聚焦 commit，并按以下格式回报：

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 SHA>
execution_base: <包含本指令的完整 SHA>
status: M5 P3-R06 范围合规纠偏已交 Codex 最终复验（非 GO、未归并）
resolved:
- P3-R06-S1: <依赖/配置恢复、现有能力真实证据、lint warning 关闭>
changed_files:
- <文件>
verification_raw_summary:
- <命令>: <退出码和原始摘要>
e2e_matrix:
- desktop Chromium: <结果>
- mobile-360: <结果>
blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P3-R06 范围合规纠偏已交 Codex 最终复验，未归并、未启动 M6。”**
