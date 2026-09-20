# 双主题 UI 重构最终复验

日期：2026-09-19。结论：**终局 NO-GO，当前提交不予验收放行。**

固定审核对象：`ff1fff84d10084c60c8181229a6e7ec28382015f`；首次实现 `171aa54a7fd9482fadad42374aa6023c00b17621`；原始基线 `f87d495a2136b0729aebd14f67ed1317e78f6f1b`。依据本任务 prd.md、design.md、cursor-remediation.md 和根 AGENTS.md。本轮为集中整改后的最终复验，不自动开启新的整改阶段，也不修改业务代码。

## 已确认修复

- 计划字段基本往返保留：原有 key、最晚开始时间、时长和五档积分不再被清零；独立无数据库脚本通过。
- 底部导航显式 top:auto，家长侧栏限定角色；整改截图中手机导航高度恢复正常。
- 头像入口接入导航保护；普通表单修改会标记 dirty。
- 学生首页拆分读取失败状态，训练读取失败不再连带清空日程。
- 手机周/月日期选择控件已补入；反应训练截图中刺激区和退出操作可见。

## Standards：实现正确性与失败恢复

### F01 / P1：定义保存与绑定连写造成部分成功，重试使用旧 revision

位置：`src/app/parent/plans/[planId]/edit/page.tsx:74–91`。

定义更新成功后，代码并行新增绑定，再逐个移除绑定；任一后续请求失败均进入同一个“保存失败”分支。定义已经提交，但组件没有接收新的 plan/revision；再次保存仍携带旧版本。服务端 `src/modules/schedule/plan-library.service.ts:467–471` 检查并递增 revision，故重试会产生版本冲突。并行绑定还可能部分成功。违反 design.md 的“保存、绑定、生成必须保持各自事务边界和错误恢复，不自动连写”。应恢复明确分开的操作和各自可恢复状态，不能以一个总保存按钮掩盖多次提交。

### F02 / P1：Modal 的焦点初始化随每次输入重复执行

位置：`src/components/ui/modal.tsx:51–89`；调用证据 `src/app/parent/plans/page.tsx:598–616`。

焦点初始化 effect 依赖 onClose，而新增计划传入内联回调。受控输入每次 setTitle/setDescription 都让父组件重渲染并产生新回调，effect 清理后重新聚焦第一个可聚焦元素（关闭按钮），打断连续输入和中文输入法。焦点初始化必须与实际打开生命周期绑定，事件处理使用最新回调但不能重新初始化焦点。此外各 Modal 都安装 document Escape 监听，叠加错误弹窗时会同时触发底层关闭，需只允许顶层处理。以上为代码路径确认，本轮未作浏览器键入复现。

### F03 / P2：删除条目再添加生成重复 key，计划无法保存

位置：`src/lib/plans/plan-draft-serialization.ts:16–17`；`src/components/plans/plan-library-edit-form.tsx:274`。

已有 item-1、item-2，删除前者后按当前 length 生成的新条目仍为 item-2。后端定义校验要求 key 唯一，用户又无法编辑内部 key，导致保存被拒绝。新增 key 必须避开现有 key，同时保留旧条目身份。无数据库执行复现得到 `["item-2","item-2"]`。

### F04 / P2：取消全部星期后，保存静默恢复旧星期

位置：`src/lib/plans/plan-draft-serialization.ts:65–73`；编辑表单 WeekdayPicker。

从原计划读取时同时保留 weeklyWeekdays 与 repeatValue。控件只更新前者；用户取消所有星期后，序列化回退到旧 repeatValue，把视觉上已取消的星期重新写回。执行复现：原 [1,3] → 全部取消 → 提交仍为 [1,3]。应以当前控件为唯一输入源，空选择明确校验，不恢复陈旧值。

## Spec：冻结验收仍未完成

### F05 / P2：浏览器后退仍未保护编辑草稿（B03 / AC06）

位置：`src/components/ui/use-unsaved-changes-guard.ts:5–14`，两角色独立编辑页。

仅 beforeunload 与 PageShell 导航回调不能覆盖 Next.js 同文档历史后退。列表经 Link 进入编辑页后修改，再用浏览器后退，走 history/popstate 而非上述两个路径。原整改要求的浏览器返回保护仍缺失。需覆盖真实浏览器历史导航并验证取消离开后保留草稿。本轮基于事件路径审查，未执行浏览器后退测试。

### F06 / P2：主题视觉与复杂新增流程仍未完整达到冻结稿（B07）

`src/app/globals.css:2222–2234` 默认隐藏 .bd-task-art，仅桌面显示；整改学生首页手机截图仍缺少高保真稿中的主题插画。不能将“组件已添加”等同于手机视觉已落地。家长新增计划仍位于 `src/app/parent/plans/page.tsx:598` 的长表单 Modal，未满足复杂新增/编辑独立承载的整改范围。此项沿用原验收线，不新增设计要求。

## 验证证据与限制

- `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-check.cjs`：退出 0，基本字段往返保留。
- `node .trellis/tasks/09-19-dual-theme-ui-refactor/review-final-check.cjs`：退出 1，确定复现 F03、F04；调用实际序列化模块，不连接数据库。
- 静态核对保存链、服务端 revision 校验、Modal 生命周期与调用方、导航保护和响应式样式；查看整改学生首页及反应训练手机截图。
- Cursor 报告的 typecheck、lint、5 个单元测试及截图生成结果为其提供的证据，不冒充本轮重新执行通过。截图元数据记录图片哈希，未直接绑定完整实现 SHA。
- 本轮未执行全量 E2E、数据库测试、build、200% 缩放、软键盘及全部训练种类实机验收；未触碰运行服务或数据库。新增训练离开 E2E 未执行，不能作为通过证据。
- 两轴由主审汇总；此前并行审查代理因额度失败，未将其当作独立通过证据。

Standards：4 项，最高 P1（部分提交后错误恢复、输入焦点）；Spec：2 项，最高 P2（浏览器后退草稿保护、冻结视觉/新增流程）。已有改善不足以抵消上述真实功能回归，当前不放行、不推送或部署，不自动发起下一轮 Cursor 指令。
