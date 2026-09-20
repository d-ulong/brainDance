# 再次审核：7a0a12b

日期：2026-09-20。结论：**NO-GO，未提交审核签署或推送。** 用户授权有问题时提供继续执行的 Prompt；对应唯一指令为 cursor-state-repair.md。

基线：`ff1fff84d10084c60c8181229a6e7ec28382015f`。
本次固定实现：`7a0a12bb5db5fcaca5d38516a1ee0f395abbb686`，main。审核前后 HEAD 相同，src/tests 无工作区修改。已有未提交截图、用户脚本、文档均保留。

## Standards

### R01 / P1：学生新增页保存后没有进入已有计划状态

`src/app/student/plans/new/page.tsx:55–58,67–80,106`。

每次点击保存均 POST 创建，成功后仍将固定 template 传给表单。表单 dirtyNotified 未因 id/revision 改变而复位；再次输入不能重新设置 dirty。启用按钮按上次 createdPlan 生成并直接离开，也不保护后改草稿。违反上一指令 F01/F05、原 AC10。

浏览器已复现：连续保存记录两次 POST /api/plan-library，第二次不是更新；再次改标题后启用，确认次数为 0，直接跳到 /student/plans，生成使用此前保存的记录。需以服务端返回 id/revision 建立保存基准，不允许编辑同一份计划却创建多份。

### R02 / P1：保存期间的后续输入被误标记为已保存

`src/components/plans/plan-library-edit-form.tsx:94–104`，两角色编辑页保存成功路径。

提交时表单仍可编辑；保存回包后无条件清 dirty，revision effect 再次清 dirty。请求发送后的新增输入没有包含在提交快照中，却失去离开保护。违反 design.md 草稿/失败与并发语义。

浏览器已复现：PATCH 提交标题 Sent snapshot，等待 mock 响应期间改为 Typed while saving；成功后取消，确认次数为 0，直接跳列表。可采用提交期间冻结可编辑控件的最小方案，或以提交快照和当前草稿比较；不能仅增加另一处 setDirty。

### R03 / P1：历史守卫不断积累同页记录

`src/components/ui/use-unsaved-changes-guard.ts:12–14,22–36`。

dirty=false 只重置 guardPushed，不清理占位历史；下一次编辑再 push。同一编辑会话中的保存/修改反复累积记录。确认后固定 back 一步仍可能留在旧占位记录，confirmingLeave 又保持 true，保护后续失效。违反 F05 禁止历史增长/返回循环。

浏览器已复现：两次保存和第三次修改使 history.length 从 2 增至 5；确认后退一次后仍位于编辑页，第三次未保存标题仍在。历史状态必须按完整生命周期设计并经真实 Back/Forward 验证。

### R04 / P2：绑定失败后清除了用户的待重试选择

`src/app/parent/plans/[planId]/edit/page.tsx:158–175`。

不论是否部分失败，重读后用已生效 bindings 覆盖 selectedStudents；失败新增/移除的目标消失，bindingDirty=false，保存绑定按钮消失。违反 F01“每项失败保留可恢复输入”。应区分服务端事实和用户目标，成功部分更新基准、失败部分保持待重试；重读失败也要保留已知成功和未确认状态。静态路径确认，本轮未执行绑定故障浏览器检查。

### R05 / P2：学生编辑页星期空选没有错误反馈

`src/app/student/plans/[planId]/edit/page.tsx:93–97` 没有传 onValidationError。共享表单发现空星期后 return，用户点击保存没有任何提示。违反 F04 的明确校验与提示要求。静态路径确认。

## Spec

独立规格复核确认：F01 待重试选择未保留；F05 保存后再编辑/启用和多次保存后的历史导航仍不成立；F04 学生编辑缺少错误提示。以上为原冻结要求，不增加功能。

F03 唯一条目 key、F04 底层星期序列化已修复。F01 定义保存与绑定操作已拆开并刷新 revision。F02 焦点初始化不再依赖 onClose，顶层 Modal 栈已加入。F06 独立新增页和手机插画可见性已落地；不要求推倒已完成的视觉工作。上述正向结果不能替代草稿完整性验收。

## 执行证据

- review-check.cjs：退出 0，原字段往返通过。
- review-final-check.cjs：退出 0，删除后新增 key 为 item-2/item-3；取消所有星期序列化为空，不再恢复旧值。脚本适配新 append 入口，没有删除原唯一性断言。
- review-7a0a12b-browser.cjs：使用安装的 Chrome 无头浏览器，全部 /api/ 请求拦截为 mock；执行退出 0 是观察脚本完成，不是产品通过。记录上述 R01/R02/R03 的失败行为。最初默认浏览器缺失、沙箱启动 EPERM；改用已安装 Chrome 并获自动审批后执行成功。
- 浏览器结果在 Windows 临时目录 braindance-review-7a0a12b.json；关键输出已完整总结于本报告，脚本保留在任务目录可复现。未访问真实业务写入。
- 两个独立审查代理分别完成 Standards/Spec，只读审查并均给出 NO-GO；主审复核具体实现，并补充浏览器证据。
- implementation-report.md 声称修复实现 SHA 为 36d23392ee4a720861bd2a442cd48291b3824454，和当前 HEAD 不同。当前截图 JSON 无 implementationSha；不能将这些证据视为固定 SHA 的完整验收。下次须在提交后报告实际完整 SHA。
- 未运行默认带数据库 setup 的全量测试、迁移或 build；未改业务代码、未暂存他人修改、未推送。

Standards 5 项（最高 P1）；Spec 5 项对应上述学生新增生命周期、启用丢草稿、历史保护、失败绑定目标、校验反馈（最高 P1），不与 Standards 重复计数。
