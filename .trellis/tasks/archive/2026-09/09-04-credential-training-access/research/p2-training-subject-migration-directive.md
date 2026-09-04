# P2 执行指令：训练主体隔离与 expand 迁移

## 交接信息

- Active task：`09-04-credential-training-access`
- 分支：`main`
- 实现差异基线：`9985bc8097445c1aa02ab3b47e614a564cb7845c`
- 本阶段只处理 `R-CTA-03` 的服务端、schema/migration 和 API 边界；P3 才创建家长训练页面和 runner 路由。
- 允许一次实现提交；完成后只可声明“已交审核”。

## 冻结的领域模型与不变量

1. 训练的权威归属是 `TrainingSubject = { traineeId, traineeRole, ageBand }`。可训练角色只有 `student` 与 `parent`；admin 或不存在的主体 fail closed。
2. 学生主体：继续由出生日期解析现有 `AgeBand`，沿用既有训练定义、有效/练习划分、趋势和训练完成 outbox/积分链路。
3. 家长主体：只能使用字面值 `adult` 年龄档的活动训练定义；训练会话、事件、metrics 和投影只属于该家长本人。不得读取或写入任何学生 session/projection，且绝不创建计划、日程、积分流水、家庭推送或面向学生的通知事实。
4. 每个训练主体、训练 key、家庭日期最多一条 `effective` 已完成会话；不同主体即使同日同 key 也互不竞争。幂等键、会话读取、提交竞争锁、投影重建、趋势读取均以 `traineeId` 隔离。
5. 训练 API 的资源 owner 只取当前认证 user，不接收任意 `studentId`/`traineeId`。家长读取学生已有训练趋势仍走既有家庭授权路径；本阶段不得把该路径泛化成家长自助训练读取。

## 数据迁移（expand，不能跳步）

对 `training_sessions` 与 `training_profile_projection` 新增语义明确的 `trainee_id`，外键指向 `users.id`。迁移须：

1. 新列先 nullable；从历史 `student_id` 一对一回填；确认无 null 后将 `trainee_id` 设为 `NOT NULL`。
2. 保留旧 `student_id` 列及其历史值作为本阶段兼容字段，但在允许家长记录前使其可为 `NULL`；新写入的学生记录同时保留旧 `student_id`，家长记录的旧列为 `NULL`。
3. 新增以 `trainee_id` 为 scope 的 start/submit 幂等唯一索引、主体-key-date/status 索引、已完成有效日唯一索引，以及 projection 唯一/查询索引。旧索引/约束不删除、不重命名、不 contract。
4. migration 必须可在含历史学生训练记录的隔离 PostgreSQL 数据库验证：数据保留、`trainee_id = student_id`、新约束生效。不得原地改写历史业务事实。

## 实施范围

- `src/db/schema/training.ts`、一个新的顺序 migration、受影响的 training service/definition/seed/rebuild/account-deletion 调用点、训练 API routes、直接受影响的聚焦测试与 P2 实施记录。
- 加入现有训练 key 的 `adult` 活动定义版本；不可改变儿童定义的历史 version/年龄档，且不得替换已有儿童 active definition。
- 可保留临时兼容的“student”命名 facade 以避免无关调用大面积修改，但所有**新增/已修改**训练入口必须显式使用 `TrainingSubject`；不能把 parent 伪装为 student ID。

## 明确禁止

- 不创建或修改 `/parent/training`、`/parent/training/[sessionId]` 或任何家长训练 UI；不改学生 runner UI。
- 不修改 points、schedule、relationships、家庭授权、家庭推送、通知、密码、用户角色、删除策略或 worker。
- 不删除 `student_id`、旧索引或历史事实；不做 schema contract、回填之外的数据修复、全库重建或生产数据操作。
- 不改任务状态、PRD/design/阶段指令/签署，不顺手格式化无关文件；不启动 dev、Docker、全量测试或全量 E2E。

## 事务与失败语义

- 训练 start/append/submit/terminate 先解析当前主体并仅加载 `trainee_id` 与其一致的 session；跨主体或不存在 session 统一返回不泄露存在性的 `SESSION_NOT_FOUND` 等既有安全错误。
- 提交必须在既有事务与竞争锁内完成。仅 `traineeRole === "student"` 可进入既有积分/outbox 分支；家长成功提交仍可更新自己的 metrics/projection 与最小训练审计，但不写学生领域表。
- 迁移和 schema 约束是数据隔离的底线；Route 角色检查不能替代 service ownership 检查。
- 所有 audit/outbox idempotency key 改为以 trainee scope 构造；不得产生 parent session 却使用学生 ID 的 key/payload。

## 必须覆盖的证据

1. 迁移：预置历史学生 session/projection，执行 migration 后 `trainee_id` 回填正确；同主体幂等与 effective 唯一约束有效。
2. 服务：家长可用 `adult` 定义 start/append/submit/read 自己的 session；家长与学生相互不能读取、追加、提交或终止对方 session；admin 被拒绝。
3. 隔离：同日同 key 的家长与学生均可各自为 effective；家长提交后没有 points ledger、schedule、family push/notification 或学生 projection/trend 变化。
4. 投影：家长 projection 可独立增量和重建；学生已有 projection/rebuild 行为不回归。
5. API：当前认证的 parent 能访问通用训练 API，student 行为保持；请求体不得携带 owner ID。

## 验证边界

先通过项目现有 migration 测试入口确认命令，再只运行覆盖上述范围的 migration/training/API 测试（共享 DB 串行）。此外运行：

```powershell
pnpm typecheck
pnpm lint
pnpm format
git diff --check
```

不得用全量 test/E2E/build 替代上述明确断言。若隔离数据库 migration 测试命令需要环境准备，记录精确前提与失败输出后停止。

## 交付格式

一次提交只含允许范围的实现、migration、聚焦测试和 `research/p2-implementation-record.md`。回报：HEAD、文件列表、R/AC 与不变量矩阵、迁移命令及结果、聚焦命令及结果、未执行项/原因、风险。不要启动 P3 或自行处理审核反馈。
