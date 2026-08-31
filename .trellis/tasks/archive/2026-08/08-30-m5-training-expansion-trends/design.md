# M5 技术设计

## 1. 边界与原则

M5 扩展现有 Training Module，不新增第三方依赖，不改变 M1–M4 的身份、授权、日程、事实、账本或反思隐私契约。`training_sessions`、`training_events` 和 `training_metrics` 继续作为权威记录，`training_profile_projection` 与趋势读取结果均为可重建投影。

固定标准会话由 `(training_key, definition_version, age_band)` 决定。训练定义不可原地修改；规则变化新增版本。新版本或生日跨档只影响之后启动的会话，历史按会话快照读取。

## 2. 训练协议

### 2.1 共享分派

将当前 reaction-only 的提交路径改为按 `trainingKey` 分派到类型化协议实现。每个协议统一提供：定义 schema 解码、预期试次数、事件验证、指标计算及指标方向元数据。未识别训练 key、定义 schema 或事件类型必须确定性失败，不能以宽松 cast 继续。

### 2.2 Stroop v1

定义保存每年龄档的固定试次数、颜色集合、一致/不一致配额与有效反应时间边界。客户端记录服务端可复核的试次序号、刺激颜色/词义、选择和反应时间；服务端验证配额、顺序、答案和边界。

指标至少包括一致/不一致准确率、两类正确试次中位反应时、有效试次数及干扰差值。干扰差值只在两类均有有效中位数时产生；缺失必需数据则会话 invalid，而不是伪造零值。

### 2.3 Digit Span v1

定义保存顺背/倒背各自的固定长度阶梯、每档尝试数、数字展示规则和边界。客户端记录模式、长度、服务端可复核的展示序列及作答；服务端验证顺序、长度、答案和尝试配额。

指标至少包括顺背/倒背最长连续正确位数及每档尝试摘要。每档摘要如不适合现有 numeric metric 行，则保留在类型化投影/查询 DTO 中，由权威事件重建；不得把任意 JSON 直接 cast 给 UI。

## 3. 数据与事务

优先复用现有表结构。只有数据库不能表达新的业务不变量时才新增 migration；定义 seed 应幂等且不得激活同 key/年龄档的多个版本。若当前 `active` 整数不能保证唯一 active definition，P1 必须以约束或事务锁修复并补数据库测试。

提交事务保持：锁定会话 → 幂等重放 → 校验事件 → 写指标 → 按 `(student_id, training_key, family_date)` 决定 effective/practice → 更新投影 → 写审计/outbox → 提交。并发下由锁与部分唯一约束共同保证每日每训练 key 只有一条 effective。

日志、审计与 outbox 仅含 session id、training key、版本、年龄档、状态和指标键等最小字段，不含答案或完整题目。

## 4. 趋势模型与读取

趋势查询显式接收 training key 与窗口 `7d | 30d | all`，返回按 `(definitionVersion, ageBand)` 分组的 segment。每个点引用 source session id、family date、session kind 和类型化指标；只纳入 completed/effective。

投影更新与 rebuild 共用同一 reducer/聚合入口，避免增量与重建语义漂移。现有 best/last 方向不能再靠 metric key 特判；指标方向由协议元数据统一提供。窗口边界使用 `Asia/Shanghai` 家庭日期。

学生读取限定本人；家长读取调用实时关系授权，不能依赖成员或趋势投影放行。不存在与无权访问保持相同外部错误语义。

## 5. UI 与交互

新增统一训练入口及 Stroop、数字广度页面，复用 `PageShell`、现有 session API 和 visibility/重试模式。计时使用 `performance.now()`，React 状态负责渲染，瞬时计时与一次性 guard 使用 `useRef`。

交互使用原生 button，提供可见焦点、至少 44px 触控目标和中文说明；Space/Enter 与点击走同一动作处理器，防止重复事件。结果与趋势用文本和小型列表/折线表达，颜色不作为唯一信息。每个 segment 明示版本、年龄档及分段原因，并持续显示“训练记录，非医学或智力评估”。

## 6. 兼容、回滚与风险

- 兼容：reaction v1 历史与现有 API 行为保持可读；新增 DTO 字段采用扩展式变更。
- 回滚：停用新增 Stroop/digit-span 定义并回滚应用；保留会话、事件、指标和迁移，不删除历史。
- 计时风险：浏览器计时只能作为事件事实，服务端校验边界与协议结构；趋势文案避免跨设备精确因果解释。
- JSON 契约风险：定义与事件 payload 必须由协议层 schema/guard 单点解析，禁止 route、service、projection、UI 各自 cast。
- 投影漂移风险：增量更新和 rebuild 必须共享 reducer，并以独立数据库测试对账。

## 7. 验证映射

P1 覆盖 AC-M5-01～04 的协议、迁移、服务与并发证据；P2 覆盖 AC-M5-05～07 的趋势、重建与授权；P3 覆盖 AC-M5-08～10 的界面、双视口和全量质量门。每阶段只在固定提交 SHA 上审核，NO-GO 问题先文档化再整改。
