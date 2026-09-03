# 凭据体验与家长训练访问实施方案

## P1：身份与密码体验

1. 定义并测试身份 Module 的 6–12 位、大写/小写/数字策略。
2. 将注册、改密和受控学生开户接入策略；新增家长改密入口与 Route 授权。
3. 实现共享 PasswordField、重复输入与可访问显示/隐藏；更新 desktop/mobile 关键 UI 用例。

## P2：训练主体与数据库

1. 新增 expand migration 与 Drizzle schema 的 `trainee_id`，回填历史记录并添加以训练主体为维度的唯一/索引。
2. 将训练 session、趋势和投影重建的内部调用收敛到训练主体 Interface；确保学生事实/积分路径仅在主体角色为 student 时可达。
3. 新增 `adult` 训练定义版本和仅家长本人可读写的 Route/DTO。

## P3：家长训练 UI 与验收

1. 新增家长训练中心和 runner 路由，复用协议组件但不复用学生 ID 或家庭学生页。
2. 覆盖家长成功训练、跨主体拒绝、学生不受影响、密码负面矩阵、确认/眼睛控件和双视口关键路径。
3. Cursor 只提交一次聚焦实现；Codex 固定 SHA 审核，必要时只有一次集中整改。

## Required Verification

- 新增/受影响身份、训练主体、迁移和 Route 聚焦测试；共享数据库测试串行。
- `pnpm typecheck`、`pnpm lint`、`pnpm format`；build/E2E 仅在 P3 的跨层 UI 证据不足时扩大。
- migration 在隔离数据库上验证，证明历史学生记录保留且家长记录不触发积分/计划事实。

## Out of Scope

- 家长积分、家长计划/日程事实、学生可见家长训练、排行榜、成人诊断或历史 schema contract 删除。
