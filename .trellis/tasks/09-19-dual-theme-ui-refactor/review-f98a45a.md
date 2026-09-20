# 审核 f98a45a：NO-GO

日期：2026-09-20。固定 SHA：`f98a45a65c5d80c4b4a647c5612926eed34a3869`；基线：`7a0a12bb5db5fcaca5d38516a1ee0f395abbb686`。审核结束 HEAD 未变化，src/tests 无实质未提交修改。未提交签署、未推送。

## 已通过的聚焦复验

- review-check.cjs、review-final-check.cjs 均退出 0：字段保留、唯一 key 和星期序列化通过。
- state-repair-browser.cjs 独立复跑退出 0：新建一次 POST 后 PATCH 同一计划、有草稿时启用前拦截、定义保存期间字段锁定、学生空星期提示与仅周五提交、失败绑定选择保留通过。
- 原浏览器脚本 R03 只断言 confirms >= 1，实际报告 confirms=2；不能据此声明“只确认一次”通过。原绑定场景 A 在初始事实中已绑定，不覆盖本次 A 写成功、B 写失败后的刷新恢复。

## Standards：4 个剩余阻断，均已浏览器复现

### S01 / P1：启用期间仍能修改，回包后静默丢草稿

`src/app/student/plans/new/page.tsx:89–108,132–141`。

PlanLibraryEditForm 仅接收 saving，不含 activating，persistPlan 也不排斥激活中保存。启动启用后输入仍可编辑，响应后直接 router.push 列表。独立 mock 延迟启用 900ms，期间输入 Edited during activation：locked=false，confirms=0，最终进入 /student/plans。属于原 R01/R02 要求的“相关写操作锁定、未保存草稿不能丢失”。

### S02 / P1：绑定期间目标仍能修改，被成功回读覆盖

`src/app/parent/plans/[planId]/edit/page.tsx:183–187,243–258`。

绑定提交中只有按钮禁用，选择器不锁。提交 B 后等待时取消勾选 B，响应后重新勾回 B；用户后续目标被覆盖。浏览器记录 locked=false、bSelected=true、retryButtonCount=0。属于原 R04 明确要求的锁定/快照策略，不能只锁定义保存。

### S03 / P2：绑定写成功但刷新失败，无可用恢复入口

同文件 `:154–197,262`。

先乐观更新 bindings 使 bindingDirty=false，随后 GET 失败提示“请重试保存绑定”，但保存绑定按钮已隐藏，applyBindings 也会因无差异提前返回。浏览器 mock 成功绑定 B 后令 GET 500：错误提示出现，retryButtonCount=0。必须提供独立读取重试，不能重新触发已成功写入，也不能靠重载丢定义草稿。当前 stub 的 effectiveFrom 使用 UTC 当前日期，而不是响应中的实际日期，恢复过程中不可冒充权威事实。

### S04 / P1：历史占位仍可通过前进返回，确认后退仍留在原页

`src/components/ui/use-unsaved-changes-guard.ts:15–21,33–59`。

clean 时 back 只是把占位留在前进栈，不是清除。保存后浏览器前进进入遗留占位，再修改、后退并确认，仍停在编辑页。浏览器记录 URL 仍为 /student/plans/review-plan/edit，visibleTitle=Unsaved after forward，已确认一次。原指令已要求前进/后退完整矩阵和方向正确；不能用再次增加固定 back 次数修复。

## Spec

R01 的单次创建和 R05 的错误反馈已修复；R02/R04 的锁定只覆盖了定义保存，未覆盖启用/绑定；R04 的刷新恢复、R03 的前进方向和一次确认要求仍未满足。以上均是 cursor-state-repair.md 冻结断言，不新增产品需求。

启用请求仍使用页面初始化 startDate，而非保存事实或明确日期选择，属于上轮已明确的日期要求；后端 max(definition.startDate, requestedFrom) 避免普通未来日期错误，但跨日旧 requestedFrom 会被拒绝。修复激活生命周期时一并使用正确日期 authority。

## 证据与限制

新增只读观察脚本 review-f98a45a-browser.cjs，复用当前 mock fixture，使用独立无头 Chrome。所有 API 请求被 mock，不写真实业务数据。脚本退出 0 表示观察完成，以上产品失败行为真实复现。JSON 输出：Windows 临时目录 braindance-review-f98a45a.json；SHA、路径、输入、禁用状态和确认次数均有记录。

Spec 独立代理完成并报告 NO-GO；Standards 代理提供中间发现后额度耗尽，主审自行核对并完成以上浏览器验证，不将未完成代理当作通过证据。未执行 build、全量数据库测试、迁移或部署；没有改业务代码。

结论：Standards 4 项（最高 P1），Spec 对应原 R01/R02/R03/R04 缺口；当前 NO-GO，按用户授权交付唯一后续指令 cursor-lifecycle-completion.md。
