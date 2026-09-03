# 凭据体验与家长训练访问设计

## 密码 Module

在 identity Module 提供唯一的密码策略 Interface：`validatePasswordPolicy(password)` 返回可定位的领域错误。注册、改密、受控学生开户和未来重置都经此 Interface；页面的重复输入只改善反馈，不能替代服务端校验。

前端提供一个可复用的 PasswordField Module：保持受控值、显示/隐藏按钮和稳定 `aria-label`，不保存或记录密码。确认字段复用同一 Module；提交前比较两值，Route 不接收确认字段。

## 训练主体 Module

训练 Module 的外部 Interface 从“学生 ID”收敛为训练主体：`{ traineeId, traineeRole, ageBand }`。Module 内部负责：

- 学生沿用出生日期解析年龄档与既有事实/积分链路；
- 家长只允许固定 `adult` 档，且拒绝进入任何学生计划、积分、家庭授权或通知调用；
- session、idempotency、有效日唯一性、metrics 与个人趋势均按 `traineeId` 隔离；
- 读取者只能读取自身个人训练记录，家长读取学生趋势仍走已有家庭授权 Interface。

数据库使用 expand migration：为 session 与个人趋势投影增加语义明确的 `trainee_id`，从历史 `student_id` 回填；新索引/唯一约束以 `trainee_id` 为准。旧列在本阶段只读兼容，后续 contract 任务才移除，历史记录不重写。

## 路由与 UI

- 训练写入 Route 从“仅学生”改为只接受学生或家长会话，并将身份交给训练主体 Module；admin 拒绝。
- 个人训练读取使用当前会话主体，不能接受任意主体 ID。
- 家长新增 `/parent/training` 与 `/parent/training/[sessionId]`；学生保留现有地址。两者复用训练 runner 和个人中心壳，不通过家长的学生页访问。
- `adult` 定义由 seed 追加，不修改历史儿童定义版本。

## Failure Semantics

- 密码不合规、重复输入不一致、当前密码错误、无会话或不支持角色均 fail closed；不更新哈希。
- 家长访问学生个人 session、学生访问家长 session、admin 训练写入均返回不泄露资源存在性的拒绝。
- 家长训练即使与学生同日同训练 key 完成，也不影响学生的 daily-effective、积分或趋势。
