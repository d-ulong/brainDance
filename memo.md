# BrainDance Engineering Memo

这里记录“当时怎么查、链路怎么走”的操作备忘。内容可以过时；执行前仍以当前任务、代码和规格为准。

## 记录经验的方式

每次发现可复用的根因时：

1. 将一句可迁移的原则写入 `lessons.md`。
2. 将定位路径、关键文件、验证命令和已知边界写入本文件。
3. 任务实施记录只保留该任务的验收证据，不取代这两个跨任务文件。

## M7 媒体上传单飞排查

### 资源链路

`Route → getRouteMediaUploadIdempotencyLock → shared postgres.js authority → reserve session → advisory lock → lockedDb → upload pipeline → unlock → release`

检查顺序：

1. 确认 Route 的 lock adapter 与 `getDb()` 使用同一 shared SQL client；测试使用 `getTestDb()` 对应 client。
2. 确认 `reserve()` 后立即进入覆盖 adapter/ORM 初始化的 `try/finally`。
3. 确认 callback 中所有查询、事务和 audit 都使用 `lockedDb`，没有回退使用外层 `db`。
4. 确认扫描、重编码、对象存储 I/O 不在 `lockedDb.transaction()` 内。
5. 用小池（例如 `max=2`）、不同 key、barrier 和有限超时证明前进性；再测同 key 串行、callback 异常后重获锁。

### M7 媒体聚焦验证

- 上传连接锁：`pnpm test -- tests/integration/family-content/media-upload-idempotency-lock.test.ts`
- 媒体核心：`pnpm test -- tests/integration/family-content/family-media.test.ts`
- 迁移 gate：`pnpm test -- tests/integration/migrations/m7-media-student-binding.test.ts`
- 变更空白检查：`git diff --check <baseline>...HEAD`

共享数据库测试须串行；日常审核不重复全量 test/E2E/build，除非里程碑或风险证据不足。

## Migration lineage 不兼容时的门禁验证

症状：`pnpm db:migrate` 在现有本地库的 `drizzle.__drizzle_migrations` 中发现历史 SQL checksum 与当前 migration 文件不一致，并在写入前 fail closed。

处理顺序：

1. 保留原库和 ledger，不执行 reset、删除 migration 行或手工改 hash。
2. 新建仅用于验证的本地 PostgreSQL 数据库，并只将 `DATABASE_URL` 的数据库名替换为该隔离库。
3. 从空白账本运行一次 `pnpm db:migrate`；之后在同一隔离库执行需要数据库的 test/E2E。
4. 在任务实施记录中分别标注“既有库因 lineage 不兼容被 gate 阻断”和“隔离库验证结果”；隔离库保留到复核结束，清理需另行授权。

## Cursor 交接检查

- 每份 Prompt 指向唯一仓库指令，包含 branch、完整 baseline SHA、允许范围、禁止事项、验证和回报格式。
- 规划时先列出所有相互依赖的代码、迁移、UI 与验收；除非存在必须先 deploy 的安全前置条件，否则合并为一份完整 Cursor 指令。审核发现问题时，把尚未开始的依赖工作并入唯一集中整改，不另开 P 阶段。
- 并发/连接/事务任务先写资源控制流：`acquire → guard → initialize → use → cleanup`，逐步标注所有者与异常出口。
- 审核若发现设计级问题，停止补丁链；先新增阶段指令，再下发一次合并后的实现。

## 本机封闭试点登录排查

症状：`localhost:3002` 可访问，但新建隔离试点库中的管理员登录返回 `Invalid credentials`。

检查顺序：

1. 用 `netstat -ano | Select-String ':3002'` 找到实际监听 PID；不要只依据 `pnpm dev` 父进程是否存在。
2. 用真实 `POST /api/auth/login` 构造最小复现；隔离库中单独验证账号密码 hash、状态和锁定状态，输出不得含密码。
3. 若隔离库验证通过而 HTTP 失败，停止已识别的旧开发服务，再用 `scripts/start-closed-pilot.ps1` 启动；随后重跑同一 HTTP 登录请求。
4. 只在服务连接目标隔离库且 HTTP 返回 200 后才发放或使用邀请码；不要通过重置密码掩盖数据库错连。
