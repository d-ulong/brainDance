# M4 P2 回归证据整改执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 审核实现 SHA：`b9fd73be83b3ba9e2594a5ff9ec0eceb26e77aa4`
>
> 整改执行基线：`b9fd73be83b3ba9e2594a5ff9ec0eceb26e77aa4`
>
> 结论：**NO-GO；仅授权完成 P2-F04。**

## P2-F04 — P2-F01/P2-F02 并发回归不是确定性验收证据

- **依据**：`planning-summary.md` 的 AC-M4-4/AC-M4-5 明确要求 grant/end 与 read/revoke 并发不破坏授权、不泄露正文；`AGENTS.md` 要求每条并发不变量有可定位测试证据。
- **文件**：`tests/integration/reflection-privacy/reflection-privacy.test.ts`，以及仅为测试同步所需的 `src/modules/reflection-privacy/grant-private-access.service.ts`。
- **原因**：当前 P2-F01/P2-F02 仅以 barrier 同时启动两个操作，`Promise.allSettled` 未断言 P2-F01 两个操作的结果，也没有强制任何危险交错。旧的“先检查 relationship、后取用户锁”实现可因调度恰好 end 先完成而通过；P2-F02 同样只证明撤权后的顺序读取，未控制读与 revoke 的交错。
- **修订动作**：将 P2-F01/P2-F02 重建为确定性、无 sleep 的独立连接测试：
  1. P2-F01 必须将 grant 暂停在**关系检查与用户锁的边界**，完成 end 后再继续；断言 grant 为 `FORBIDDEN`、没有 active grant、重新关联后读取仍拒绝且无正文。该测试必须会让旧锁顺序实现失败。
  2. P2-F02 必须控制 revoke 持有其用户锁时的读取交错，并明确断言 read/revoke 的允许线性化结果及撤权提交后的 fresh read 拒绝且错误序列化不含正文。
  3. 不得忽略关键 promise 结果；每个并发参与方必须有明确的成功/拒绝断言。
- **测试同步边界**：本仓库既有模式允许 service 的独立、可选 `options?: { testHooks?: ... }` 测试 seam（参照 `settlement.service.ts` 与 `persist-expired.service.ts`）。若为确定性验证不可避免，允许仅以该**第二参数 options**形式加入最小 test hook，并注释其为 test-only；禁止把 hook 放入 `GrantPrivateAccessInput`/`RevokePrivateAccessInput` 业务 DTO、Route 请求或持久化数据。生产调用必须省略 options；不得用环境变量、全局状态、sleep 或其他生产行为分支。
- **验证方式**：P2-F01/P2-F02 在隔离 PostgreSQL 下独立重复运行至少 5 次（报告原始命令和每次结果），再执行完整质量门。证据必须指出旧实现为什么会失败，而不是仅说明新实现通过。
- **允许范围**：仅 P2 reflection privacy service、该集成测试与最小测试 helper/record；禁止 Route/UI/schema/迁移、依赖和其它模块变更。

## 交付与质量门

1. 先确认工作区干净，严格以本指令 commit SHA 为执行基线；禁止 merge、rebase、reset、push。
2. 只处理 P2-F04，并在 `research/p2-implementation-record.md` 写明确定性交错、5 次独立结果与完整质量门摘要。
3. 在隔离 Docker PostgreSQL、无并发 runner 条件下串行执行：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

4. 提交一个聚焦整改 commit。回报必须包含：branch、完整 HEAD SHA、完整执行基线 SHA、已解决 ID、修改文件、5 次独立回归命令与结果、完整质量门原始摘要、blocker。最后只能写：**“M4 P2 回归证据整改已交 Codex 审核（非 GO）。”**
