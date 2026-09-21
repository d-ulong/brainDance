# 太空主题可读性、家长导航与目标500修复

## Goal

修复太空主题中说明文字和学生选择列表对比度过低、家长端桌面一级导航被挤成左侧栏，以及目标页因数据库未迁移而返回 500 的问题，并形成可直接执行的生产更新流程。

## Requirements

- 太空主题下，普通说明、弱化说明、弹窗学生选择项和禁用文字必须清晰可读；糖果主题保持现有视觉层级。
- 家长端桌面一级导航统一使用页面顶部横向导航，不再显示左侧竖向一级导航；移动端底部导航保持不变。
- 目标接口在应用所需迁移未应用时不得表现为无提示的通用 500；生产启动流程必须在启动新代码前完成数据库迁移和新构建。
- 不改变目标状态机、授权、积分规则或已有业务数据。

## Acceptance Criteria

- [ ] 太空主题中指定两处文字及同类弱化文字达到可读对比度，学生列表不再出现白底浅字。
- [ ] 家长首页、学生列表、计划及目标页面在桌面端均为顶部横向一级导航。
- [ ] 缺少目标字段时，聚焦检查可以识别迁移缺口；应用迁移后目标读取测试通过。
- [ ] 生产启动脚本先迁移、再构建，任一步失败均停止启动，不会复用旧 `.next` 产物。
- [ ] 聚焦测试、类型检查、lint、格式检查和生产构建通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
