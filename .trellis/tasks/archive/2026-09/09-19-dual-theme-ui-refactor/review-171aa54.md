# 固定 SHA 复核：NO-GO

基线 `f87d495a2136b0729aebd14f67ed1317e78f6f1b` → 实现 `171aa54a7fd9482fadad42374aa6023c00b17621`，2026-09-19。实施代码工作区无额外修改；implementation-report.md 有未提交更新，作为补充声明读取，不当作固定提交测试证据。

结论：**NO-GO，需一次集中整改后最终复验。** 已有主题基础和任务优先首页，但当前有业务字段丢失、首屏遮挡、离开保护失效，且多项冻结范围尚未完成。不得推送/部署或宣称任务完成。

## Standards：工程与行为缺陷

### B01 · P1：计划编辑序列化丢失已有规则

`src/components/plans/plan-library-edit-form.tsx:24–79`：读取草稿不保留 key、latestStartTime、durationMinutes、points；保存时重建 key、两个时间字段置 null，五档积分全部置 0。家长新编辑页直接使用此表单，因此只改名称甚至原样保存也会改变计划规则。违反 AGENTS 聚焦变更/业务不变量、R06/R10。

独立无 DB 复现：`node .trellis/tasks/09-19-dual-theme-ui-refactor/review-check.cjs`，退出 1；输入 17:10 最晚开始、20 分钟、10/5/3/1/-2 积分，输出 null/null/全零。必须完整往返保留未改字段，计分/时限有原能力的场景继续可编辑；补原样保存和只改标题的回归测试。

### B02 · P1：固定导航纵向拉伸，遮住手机首屏

`src/app/globals.css:1888–1898` 设 fixed/bottom:0 未清理旧 top；`1783–1785` 留下 top:0（768–899 仍继承 759 的 top:0.5rem）。因此导航上下双边定位伸满视口。提交的 `evidence/sample-student-home-360.png` 明确整屏为五列导航，正文被遮住。这不是极短视口问题，也不能通过给正文加 padding 修复。须整理冲突规则，保证底栏高度受控且不遮挡 CTA、训练和保存栏。对应 AC02/03/07/09。

### B03 · P1：未保存草稿保护没有跟随输入

`src/app/student/plans/[planId]/edit/page.tsx:20,85–87` 与家长同页 `22,88–90`：dirty 初始 false，仅提交时设 true；编辑输入后点取消/返回/导航不会确认。表单缺少 onDirtyChange，刷新/浏览器返回保护也未实现。须按草稿变化标记，并覆盖所有离开通道与成功保存后的清理。对应 AC06 和失败矩阵。

### B04 · P1：新增头像链接绕过会话离开门禁

`src/components/ui/page-shell.tsx:67–73` 头像 Link 直达 /account，没有接入同文件 navigate/onBeforeNavigate。训练 runner 的 lifecycle.confirmLeave 仅传给受保护通道，用户可由头像直接离开活动训练，编辑页也有同样漏洞。须统一所有 shell 内导航入口的确认/终止协议，补训练中点击头像取消/确认两条断言。对应 AC07/10。

### B05 · P2：独立训练读取失败拖垮整个学生首页，并伪装为零/空

`src/components/home/student-home-dashboard.tsx:101–123,251–260`：六个读取被同一个 Promise.all 绑定，任一训练摘要失败都会丢弃成功的日程/积分；catch 后展示“今天还没有日程”、余额 0、今日 0，trainingError 从未设 true，训练区仍加载中。须分区域处理读取/重试，错误显示未知而非 0，保留可信成功数据并明确旧数据。对应 AC08、失败矩阵。

## Spec：范围与验收缺口

### B06 · P1：手机周/月概览未实现，桌面仍从凌晨开始

`src/app/globals.css:2153–2161` 隐藏日/周/月全部网格，`schedule-calendar.tsx:168` 起只显示 selectedDate 单日列表。切周/月仅改变翻页步长，没有屏宽内周/月选日概览；桌面仍直接渲染 0–23 小时，无初始定位。按 AC04 完成周/月日期选择与分布、桌面相关时段定位，保持全部 24 小时可访问。

### B07 · P1：冻结的页面/交互范围尚未完成

不是追加需求，须补齐既有 R/AC：

| 原验收 | 当前缺口 | 核实依据 |
|---|---|---|
| AC01/02 双主题高保真 | 主任务无任一 SVG 主题插画；学生桌面也被无条件套用家长侧栏；主按钮/卡片形态偏离批准稿 | student-home-dashboard.tsx 主卡片；globals.css:1856 将全部 bd-app-body 分两列；实拍桌面图对照 HTML |
| AC03 家长管理 | 学生管理页/二级导航未改造，不能以首页重排代替管理入口与对象上下文验收 | 固定 diff 无学生管理/StudentManagementTabs 改动，旧二级横向导航仍在 |
| AC05 计划列表 | 原筛选全展开、五操作和手机密度基本保留 | parent/plans/page.tsx:465 起；本次该页只新增编辑跳转等少量修改 |
| AC06 复杂编辑 | 新增仍进旧 Modal；每周仍逗号输入；独立页无适用对象分组/维护入口 | parent/plans/page.tsx:535 起；plan-library-edit-form.tsx:183 起。对象读写保持原事务，不要求合并保存 |
| AC07 训练专注 | 只替换准备页 section 类；进行态仍完整 PageShell、导航/返回/免责声明 | reaction-training-runner.tsx:349 起及另外两个 runner diff；未使用 hideTabs/专注布局 |
| AC08 空/错与模态 | 计划无匹配仍“还没有计划”；Modal 无初始焦点、trap、Escape、恢复；家长错误仍跳别页重试 | parent/plans/page.tsx:531；ui/modal.tsx:36–82；parent-home-dashboard.tsx |

这些项应作为一个集中整改包完成；不得再次以“未改业务”为由跳过布局/键盘/状态要求。采用原 HTML 视觉标准，无需继续 Figma。

### B08 · P1：验收证据不对应提交

16 张截图中以下 10 张与 `docs/ui-audit/2026-09-18/` 同名历史图 SHA256 完全相同：全部 6 张 parent-home、student-home-768、student-home-candy-360、student-home-empty-360、student-home-error-360。糖果图仍显示旧“今天，向前一步”欢迎块，与当前组件不符。不能作为此 SHA 双主题/角色/状态覆盖证明。

重新在最终整改 SHA、隔离输出目录捕获所需矩阵，失败不得混用临时目录遗留文件。每张附 SHA、路由、角色、主题、视口、数据来源；脚本退出 0 后仍人工看图，补新编辑页和训练进行态。390、768、缩放/软键盘/键盘项准确报告。现有六条 helper 测试不能覆盖编辑数据往返和离开生命周期。

## 验证范围与限制

- 固定 diff 39 文件，核查报告、关键源代码、提交截图；独立 plan 序列化复现失败；历史图逐文件哈希比对。
- Cursor 声明 typecheck、变更 ESLint、6 条单测通过；本轮没有重复这些低相关检查。未运行 build、迁移、DB/全量 E2E，也未启动新浏览器会话；首屏结论基于已提交截图和可定位 CSS 冲突。
- 两个并行审核代理均因调用额度失败；没有将其计为通过，以上均由主审核独立核实。
- 不改业务代码、不归并、不推送；实现任务保持 in_progress。整改保持同一验收线，完成后按新固定 SHA 最终复验。

两轴统计：Standards 5 项（最高 P1，规则丢失/首屏遮挡/离开门禁）；Spec 3 组（最高 P1，冻结范围与证据未闭合）。
