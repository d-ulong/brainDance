# M7 P2 Reserved Session Cleanup 唯一指令

## 阶段边界

这是用户批准的新微型返工阶段，只修复 reserved session 在 adapter/ORM 初始化异常时可能泄漏的问题。基线由 Codex 提交本指令后在 Cursor Prompt 中填写。不得修改上传幂等语义、连接 authority、migration、purge、capability 或 UI。

## 不变量

资源控制流必须严格为：

`reserve → try/finally guard established → adapter/ORM initialize → advisory lock → callback(lockedDb) → unlock → release`

- `reserve()` 成功后，任何可抛出初始化都必须发生在 release 的 `finally` 内。
- advisory lock 成功后才执行 unlock；adapter/ORM 初始化或 lock acquisition 抛错时仍必须 release。
- callback 使用同一 reserved session 的 `lockedDb`，原有“一个上传只占一个 session”的不变量不变。

## 实现与测试

- 将 `attachDrizzleSessionSupport`、`drizzle(reserved, ...)` 及后续 lock setup 放入 outer `try/finally`。
- 采用最小可测试 adapter factory seam 注入“初始化抛错”；不要创建进程级 test hook 或新 client/pool。
- 增加测试：reserve 成功后、lockedDb 初始化抛错，断言 session 被 release；随后同一个 `max=1` pool 能在有限超时内再次 reserve/执行查询或获取同 key lock。
- 保留同 key 串行、不同 key 并行、`max=2` 饱和前进、callback 抛错后重获锁测试。

## 验证与交付

- 只运行 `media-upload-idempotency-lock.test.ts` 与 `git diff --check`。
- 在 `p2-architecture-rework-record.md` 记录该异常出口的 acquire/guard/initialize/use/cleanup 证据。
- 只创建一个聚焦提交；不 push、merge、部署或操作用户数据库。
- 回报完整基线/HEAD、控制流、初始化失败测试结果、未运行项和工作区状态，结尾写“已交 reserved session cleanup 终审”。

