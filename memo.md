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

## Cursor 交接检查

- 每份 Prompt 指向唯一仓库指令，包含 branch、完整 baseline SHA、允许范围、禁止事项、验证和回报格式。
- 并发/连接/事务任务先写资源控制流：`acquire → guard → initialize → use → cleanup`，逐步标注所有者与异常出口。
- 审核若发现设计级问题，停止补丁链；先新增阶段指令，再下发一次合并后的实现。

