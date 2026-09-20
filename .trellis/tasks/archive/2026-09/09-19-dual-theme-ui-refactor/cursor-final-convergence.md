# 唯一执行指令：计划生命周期最终收敛

日期：2026-09-20。

Active task：`.trellis/tasks/09-19-dual-theme-ui-refactor`
分支：`main`
完整基线：`72db812bc10b9ed9bd39e65a2ad516c35a7b59e0`

用户要求在多轮交互后一次分析并收敛问题。本文件是下一轮唯一执行入口，不新增产品阶段或视觉范围。先读取根 AGENTS.md、本任务 prd.md、design.md、cursor-lifecycle-completion.md 与 review-72db812.md；旧 Prompt 仅作历史。开始前核对分支、完整 HEAD、工作区，不一致立即停止并报告。不得覆盖或暂存用户启动脚本、截图、lessons/memo、设计稿和 Codex 审核文档。

不要继续给现有布尔补丁链加例外。先在实施记录中冻结“定义草稿、绑定事实、绑定目标、写操作、重读、历史导航”的单一状态模型和互斥矩阵，再一次实现以下全部事项。

## C1：关闭所有定义/绑定/启用竞争窗口

- 家长计划编辑页的定义保存、绑定保存、绑定重读三者互斥。任一操作进行时，所有会与其结果竞争的字段和按钮必须锁定；每个 handler 同时检查同步 ref lock，不能只依赖下一次 React render 后的 disabled/state。
- `saveDefinition` 检查绑定保存/重读 lock；`applyBindings` 和 `reloadBindingsFromServer` 检查定义保存 lock。可用一个明确的 operation 状态或少量同一 authority 的 ref，不保留相互矛盾的多套门禁。
- 学生新增页 `persistPlan` 必须检查 `activateLock.current`；`activateSavedPlan` 必须检查 `saveLock.current`。双击、同一 render 窗口程序触发、延迟响应都不能并发 POST/PATCH/activate。
- 不改变后端合约，不自动串联定义、绑定、启用。

确定断言：绑定 POST 延迟 800ms 时标题和定义保存均禁用，PATCH 数为 0；定义 PATCH 延迟时绑定保存与重读禁用且无绑定请求；启用与保存两个方向的同 tick 调用最多发出一个业务写请求。

## C2：重读绑定时保留用户尚待处理的目标

- 将“服务端绑定事实”和“用户选中的目标”作为两个状态。重读前以当前 binding facts 为基准，记录 selectedStudents 相对基准的新增/移除 delta；服务端返回后只更新 bindings 事实，再把该 delta 应用到新事实上形成新的 selectedStudents。
- 绑定重读只负责 bindings，不得用整个 refreshed plan 覆盖当前 definition/revision 并清掉定义 dirty。若发现计划 definition revision 外部变化，保持本地定义草稿并明确提示冲突，不能静默宣称 clean。
- 服务端没有返回目标 plan 时视为读取失败，保留重试入口和所有草稿。重读失败/再次失败均保持入口。
- 成功写的 effectiveFrom 使用响应/服务端事实；不伪造日期。

确定断言：B 已成功但首次 GET 失败后，用户取消 B，再点击重读；重读成功后 B 仍保持待移除、保存绑定按钮可用，下一次只发送 remove B。另测待新增 C 同样保留。定义标题草稿和 dirty 全程不变。

## C3：重新设计历史保护，不再修补 sentinel 布尔链

当前 `pushState(same URL) → clean 时 replaceState(null)` 必然留下重复编辑页，必须更换设计。要求：

- 保存变 clean 后一次 Back 直接离开编辑页；dirty Back 取消仍在原页且草稿完整，确认一次即到真实目标；不能固定多 back 凑结果。
- 前进必须先构造一个真实 forward 目的地并断言 traversal 实际发生，不能在历史栈末端调用 `history.forward()` 后继续测当前页。
- 至少覆盖：列表→编辑 clean Back；dirty Back 取消/再次确认；三轮修改/保存；真实 Back→Forward 两个方向；站内取消/头像；直接深链；离开后重新进入；刷新/关闭。
- history length 不随保存轮数增长；没有 ghost edit entry、返回循环或永久关闭保护。每次用户动作最多一次确认。
- 保留 Next 当前 history state 的全部字段，不以纯对象/null 覆盖；不修改或包装 Next 私有实现。移除无效的 `skipPop` 和其他无状态转移来源的 ref。
- 若 Next App Router 公共能力无法可靠取消浏览器 traversal，采用本项目范围内可证明的降级（例如受保护编辑入口使用完整文档导航，由 beforeunload 负责浏览器 Back/Forward/刷新，站内 PageShell 继续使用现有确认），并在实施记录说明行为和覆盖入口；不能继续提交一个只对单条脚本成立的伪阻塞器。

先写真实浏览器失败用例，再实现。把 `review-72db812-browser.cjs` 的 clean 单次 Back 观察转成强断言。测试 exact pathname、exact confirm count、history length/真实目标；测试若不先证明 forward 目的地存在则不得计为通过。

## C4：证据与交付账务

- 修复 `implementation-report.md` 重复的 S01–S04 段，保留一份最终状态表；写入实际完整实现 SHA，不能写“与 git rev-parse 一致”。
- 所有最终浏览器 JSON 顶层写入同一 implementationSha，并在启动时比较 `git rev-parse HEAD`，不一致直接失败。测试脚本退出 0 只在全部断言通过时成立，不把观察输出当 pass。
- 保留已通过的字段往返、唯一 key、星期校验、Modal、主题和视觉实现，不扩大范围或修改训练业务。

## 必须执行

1. `review-check.cjs`、`review-final-check.cjs`。
2. 修正后的 state-repair-browser.cjs、review-f98a45a-browser.cjs、review-72db812-browser.cjs，全部 API mock，且包含 C1–C3 的完整断言。
3. `pnpm typecheck`、变更文件 ESLint/Prettier；记录退出码。
4. 不运行默认破坏性 DB setup、迁移、试点 DB；dev 服务运行时不在同目录 build。无需机械全量测试。

完成一次聚焦提交，包含实现、回归测试和去重后的实施记录。提交后再次运行全部聚焦命令，让证据绑定最终完整 SHA。回报 C1–C4 逐项断言、实际完整 SHA、命令退出码及确实未执行项；只声明“已交审核”。不改任务状态/审核签署，不自行推送或部署。Codex 复核通过后按用户授权提交必要签署并普通推送。
