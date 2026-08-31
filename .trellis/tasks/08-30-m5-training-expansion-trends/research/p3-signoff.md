# M5 P3 与里程碑签署记录

> 状态：**GO**
>
> 固定实现 SHA：`efa4e021dc61776f64173773a279a024324600ec`
>
> P3 原始实现 SHA：`a5d021eb6b057bb9cfb93a11a560060c9b2cc138`
>
> 最终纠偏执行基线：`76f95016ed41de01e5bd16219188295580483d48`

## 已覆盖

- R-M5-06 / AC-M5-08：反应力、Stroop、数字广度三项训练的学生 UI，触控/鼠标与键盘输入、非诊断提示、结果页和双视口主路径。
- R-M5-07 / AC-M5-09：visibility 暂停、累计失焦 abandoned、弱网有序重试、刷新/重新登录，以及 pending stimulus 与 Digit Span timer 的同步门禁修复。
- R-M5-08：训练/趋势隐私边界、学生本人和实时 active 家长授权、解除关系后的统一拒绝语义。
- AC-M5-10：学生/家长趋势窗口和 segment 展示、desktop Chromium 与 mobile-360 联合验收、无横向滚动及完整实施记录。
- P3-R01～R06 与 P3-R06-S1：入口、输入、趋势、E2E helper、lifecycle coordinator、同步 ref、timer 恢复及未授权测试依赖均已关闭。

## 独立质量证据

- 固定 SHA 代码与范围复验：`git diff --check 76f9501..efa4e02` 通过，工作区干净，未授权 `@testing-library/react` / `happy-dom` 和全局 Vitest 扩张已移除。
- Codex 聚焦复验：P3-R06 lifecycle desktop Chromium 5/5；`pnpm typecheck`、`pnpm format` 通过；`pnpm lint` 0 error，仅 5 个既有 warning。
- Cursor 最终记录：全量 E2E 46/46；desktop Chromium 23/23、mobile-360 23/23，其中 M5 + P3-R06 每视口 16/16；build 通过。
- 全量 Vitest 的 P1 advisory-lock helper timeout/cleanup aggregate 属已签署的诊断债，不改变 M5 生产规格结论。

## 验收线审计与非阻断债

- 最终 Playwright 的 Digit Span 用例覆盖隐藏期间不推进与恢复一次，但未精确强制 callback 在 React pause effect 前到期。生产门禁修复、旧真实 hook 回归证据和双视口结果共同支持放行；依据三轮上限，不继续递归审核测试证据工具，记录为非阻断测试强化项。
- P1 advisory-lock helper 诊断、Stroop E2E 的 `data-ink-color` 读取、少量重复 UI 与 trend tab race 保留为非阻断技术债。
- 未覆盖部署、生产数据迁移执行与真实设备矩阵；本签署不授权部署。

结论：P3 GO，M5 规格范围完成。准许按独立归并指令将功能分支仅快进归并至本地 `main`、推送并核对 `origin/main`；在归并核验完成前不得启动 M6。
