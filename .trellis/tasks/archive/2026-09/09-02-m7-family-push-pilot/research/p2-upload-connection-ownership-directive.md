# M7 P2 上传连接所有权返工唯一指令

## 新阶段与边界

- 本指令是用户批准的新返工阶段，替代已完成的 P2 封板复验；不改变 P2 产品范围或已有媒体状态机验收。
- 目标只解决上传幂等单飞的连接所有权与连接池前进性。
- 返工基线由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 本阶段只允许一份实现提交与一次最终复验；最终复验只输出 GO 或终局 NO-GO，不追加补丁轮。

## 不变量（必须同时成立）

1. 同一 `(uploaderId, idempotencyKey)` 的并发上传在同一 PostgreSQL authority 上串行，返回同一个 ready media：恰一个 created、其余为 idempotent replay；只有一个 media object 和一条 `media.uploaded` audit。
2. 不同 key 可以并发；连接池达到容量时请求可以排队，但所有持锁上传必须继续前进，不能发生“持有一条锁连接又等待第二条查询连接”的饥饿死锁。
3. 一个上传在锁存续期间最多占用**一个**共享 postgres.js session；该 session 同时承载 advisory lock 和该上传所需的全部数据库读写/事务/audit。
4. 扫描、重编码、对象存储 I/O 仍在数据库事务外，但允许在同一 reserved session 的 advisory lock 持有期间执行；不得打开第二个 pool/client，也不得把外部 I/O 放入 DB transaction。
5. 所有生产和测试 adapter 必须绑定到对应 `Database` 的同一 postgres.js authority；domain module 不得读取 `DATABASE_URL`、创建 client/pool，或隐式取得全局数据库。
6. 锁 acquire/release、reserved session release、异常传播必须以嵌套 `finally` 保证；lock acquisition 或 callback 失败后不得遗留 advisory lock 或 session reservation。

## 指定 interface 与实现形状

- 将 `MediaUploadIdempotencyLock` 收敛为回调接收 locked database 的 interface，例如：

  ```ts
  withLock<T>(
    uploaderId: string,
    idempotencyKey: string,
    run: (lockedDb: Database) => Promise<T>,
  ): Promise<T>
  ```

- `createPostgresMediaUploadIdempotencyLock(sharedSql)` 只可对传入的 `sharedSql` 调用 `reserve()`；取得 `reserved` 后在这个**同一** session 上创建 Drizzle `Database` adapter（携带当前 schema），在 acquire lock 后将其传给 callback。
- `uploadFamilyMedia(db, input)` 在 `withLock` callback 内只使用 `lockedDb`：包括 replay 查找、授权、insert、pipeline 状态更新、ready/audit 事务和恢复路径。锁外仅允许输入校验、payload hash、magic/MIME 校验等纯计算。
- Route production adapter 由 `getDb()` 同一 backing shared SQL client 构造；测试 adapter 由 `getTestDb()` 同一 backing test SQL client 构造。不得新增 route-level test hook 或第二条连接 authority。

## 必要测试矩阵

1. 同 key、同 payload、独立调用并发：严格断言 `[created, replay]`、同 media id、一行媒体、一条 uploaded audit。
2. 不同 key 并发：仍可同时进入 callback，不互相串行。
3. **池容量饱和回归**：在隔离测试数据库使用明确 `max=2` 的唯一 shared pool；同时启动两个不同 key 的锁回调，每个 callback 使用传入 `lockedDb` 执行真实 SQL 查询并等待 barrier。以有限超时断言两个 callback 都完成。旧“reserved + 外层 db”结构应无法满足该测试。
4. callback 抛错与 lock acquire 后异常：断言 session 可被后续同 key 获取，且没有遗留锁/连接 reservation。
5. 保持既有媒体核心测试通过；不重写 purge/migration/capability 的测试或实现。

## 验证与交付

- 只运行 `media-upload-idempotency-lock.test.ts`、受影响 `family-media.test.ts` 和 `git diff --check`；不要运行 migration、E2E、全量 test/build/lint/typecheck。
- 更新 `research/p2-architecture-rework-record.md`，新增本阶段的 connection ownership、session lifecycle、容量上限、失败清理与精确命令证据；不得改写既有审核结论。
- 只创建一个聚焦返工提交；不 push、merge、部署、操作用户数据库或更改 migration。
- 回报完整基线/HEAD、不变量逐项证据、变更文件、测试结果、未运行项和工作区状态，结尾写“已交上传连接所有权终审”。

