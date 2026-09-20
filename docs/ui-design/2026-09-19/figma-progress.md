# Figma 高保真稿进度

2026-09-19。用户授权将已确定双主题方向制作成 Figma 高保真稿，未授权正式应用实施。

文件：https://www.figma.com/design/4G7FNmik1JSyRWoMWfzkq2

## 已完成

- 太空学生首页完整网页参考捕获：`7:2`（1280 宽），原生文字/图层；临时窄屏参考 `3:2`。
- 双主题配色：BD Primitives、BD Space、BD Candy，语义颜色引用原始颜色。
- BD Layout 尺寸变量；BD Display/Heading/Section/Body/Label/Caption 文字样式；两套 Raised 阴影。
- 主按钮组件集 `8:20`：双主题 × Default/Pressed/Disabled，6 个变体。默认 Space `8:2`、Candy `8:5`。
- 任务行组件：Space `8:21`、Candy `8:27`，可改标题、时间、状态与尾部文字。
- 下一任务卡组件：Space `9:2`、Candy `9:36`，嵌入按钮实例和源稿 SVG 插画。两者已截图检查。
- 说明画板 `6:17`。

## 尚未完成，不能当作最终交付

- 桌面画板 Space `6:22`、Candy `6:23`：只有页眉、空导航容器、问候，尚未装入主要内容。
- 手机画板 Space `6:24`、Candy `6:25`：空画板。
- 未完成导航组件、任务与积分/训练区组装、最终整页截图与手机检查。
- 按钮变体网格顺序需要整理为同主题一行。
- 最终组件化页面验收通过后才清理临时捕获 `3:2`、`7:2`。

## 阻塞

Figma MCP 明确返回：You've reached the Figma MCP tool call limit on the Starter plan.
whoami 确认唯一团队为 Starter，seat=View。重复只读调用同样被限制。未购买/升级套餐，未调整任何账号权限。

## 恢复

先核实 Figma MCP 可用额度，再读取文件当前状态，按上述真实 ID 继续。不要重复创建文件或覆盖已有组件。中文字体：本地稿 Segoe UI/Microsoft YaHei/PingFang 不在工具字体库，此 Figma 版明确使用已查询到的 Noto Sans SC Regular/Medium/Bold。

本地 `figma-reference.html` 是独立设计页加官方 capture.js 的捕获副本；不修改生产 `src/`。临时 HTTP 服务端口 8765，本轮结束关闭。
