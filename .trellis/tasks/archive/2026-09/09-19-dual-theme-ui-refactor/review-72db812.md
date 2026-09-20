# 终局复核：72db812

日期：2026-09-20。结论：**NO-GO，不提交签署、不推送。**

- 固定实现：`72db812bc10b9ed9bd39e65a2ad516c35a7b59e0`
- 对比基线：`f98a45a65c5d80c4b4a647c5612926eed34a3869`
- 提交：`72db812 fix(ui): complete plan edit lifecycle guards for S01-S04`
- 审核前后 HEAD 未变化，`src/`、`tests/` 无工作区改动；已有截图、用户脚本、lessons/memo 和 Codex 文档原样保留。

本轮不再把“已有脚本通过”等同于完整验收。除复跑 Cursor 断言外，新增了未覆盖路径的真实浏览器检查，全部 `/api/**` 均为 mock，不接触真实数据。

## Standards

### S1 / P1：绑定操作仍能与定义保存并发

位置：`src/app/parent/plans/[planId]/edit/page.tsx:93–116,119–252,278–308`。

绑定保存时只禁用 StudentMultiSelect 和绑定按钮，PlanLibraryEditForm 仍只接收 `savingDefinition`；`saveDefinition` 也不检查 `savingBindings`、`refreshingBindings` 或 `bindingApplyLock`。因此绑定 POST 后的计划重读可与定义 PATCH 并发，晚到的 GET 会重新 `setPlan(refreshed)`，可能回写旧 revision/definition，并触发表单按 revision 清理 dirty。

浏览器 mock 已复现：绑定请求延迟 800ms 时，标题 `disabled=false`、定义保存按钮 `disabled=false`，实际发出 1 次并行 PATCH。违反冻结指令 S02“锁定会与刷新发生竞争的写操作”。

### S2 / P1：绑定重读覆盖刷新期间新增的待处理意图

位置：同页 `reloadBindingsFromServer():119–139`。

写成功、GET 失败后恢复入口已补上，但重读成功无条件用服务端 bindings 覆盖 `selectedStudents`。用户在点击“重新读取绑定”前新增的待保存添加/移除会被静默清除；返回的整个 plan 还会影响定义 revision/dirty。

浏览器 mock 已复现：绑定 B 已成功但首次 GET 失败；用户随后取消 B（新的待移除意图），点击重新读取后 B 被重新勾选，保存绑定按钮消失。结果：`selectedBeforeRefresh=false`、`selectedAfterRefresh=true`、`saveBindingsVisibleAfterRefresh=0`。违反 S03“重读不丢尚待处理目标”。

### S3 / P1：历史守卫在 clean 状态仍留下重复编辑页

位置：`src/components/ui/use-unsaved-changes-guard.ts:23–42,68–74`。

dirty 时 push 同 URL guard；变 clean 时仅把当前 guard `replaceState(null)`，并未回收重复条目。保存成功后用户只按一次浏览器后退，仍停在相同编辑页，第二次才回列表。

浏览器 mock 已复现：保存后 history length 为 4；第一次 Back URL 仍为 `/student/plans/review-plan/edit`，第二次才到 `/student/plans`。这违反状态表“clean 直接离开”和 S04 的完整生命周期要求。

当前实现还以纯对象/null 写 history state，并遗留从未置 true 的 `skipPop`。即使 Next 当前会包装 history 方法，这种隐式多布尔状态机也没有证明前进、直接打开、重新进入和卸载语义。已有脚本在历史栈末端调用 `history.forward()`，没有断言它真实移动，因此不能作为 forward 验收证据。

### S4 / P2：函数级互斥仍未闭合

位置：`src/app/student/plans/new/page.tsx:54–58,100–104`。

`persistPlan` 只读 React 的 `activating`，未检查同步设置的 `activateLock.current`；`activateSavedPlan` 也未检查 `saveLock.current`。UI 在下一次 render 后会禁用，但同一事件/render 窗口内函数级门禁不完整，与指令要求的“操作函数也防止并行提交”不符。应让两个操作检查彼此的同步 lock，而非只依赖异步 state 刷新。

### Verification / P2：交付记录与证据仍未绑定最终 SHA

`implementation-report.md` 的最新 S01–S04 段重复两次，仍写“与本次聚焦提交 git rev-parse HEAD 一致”，没有记录实际完整 SHA。两个浏览器脚本输出也没有 implementationSha。冻结交付要求是提交后以实际完整 SHA 绑定证据；当前记录不能独立证明脚本针对哪一提交运行。

## Spec

独立 Spec 审查结论同为 NO-GO：S02 的竞争写锁、S03 的待处理目标保存、S04 的 clean/forward/history 生命周期仍未满足。独立 Standards 审查亦为 NO-GO，并指出相同三个 P1；两轴没有新增产品范围。

已确认改善：启用期间字段已锁定，激活日期改用已保存 definition.startDate；绑定输入本身在提交中已锁；刷新失败有可见读取入口；Cursor 原有聚焦脚本均执行通过。这些修复保留，不应推倒重做。

## 本轮执行证据

- `pnpm typecheck`：退出 0。
- `pnpm lint`：退出 0；8 个既存 warning、0 error。本轮文件没有新增 lint error。
- `git diff --check f98a45a...HEAD`：退出 0。
- `review-check.cjs`、`review-final-check.cjs`：此前本审核链已复跑退出 0，字段往返、唯一 key、星期序列化保持通过。
- `state-repair-browser.cjs`：退出 0，报告原 R/S 断言 pass；但其 S04 forward 前置不成立，不能覆盖 S3。
- `review-f98a45a-browser.cjs`：退出 0，报告 S01–S04 既有断言 pass；同样未覆盖 clean 单次 Back、定义/绑定并发和待处理选择合并。
- `review-72db812-browser.cjs`：退出 0 表示观察脚本完成；固定 SHA、全部 API mock，并确定复现 S1–S3。JSON 位于系统临时目录 `braindance-review-72db812.json`。
- 未运行 build、全量 E2E、迁移或数据库测试；遵守 dev 运行目录和数据库安全边界。现有实际阻断无需依赖这些高成本检查才能成立。

结论：Standards 5 项（最高 P1）；Spec 3 项（最高 P1）。当前不能提交审核签署或推送。唯一后续执行指令为 `cursor-final-convergence.md`。
