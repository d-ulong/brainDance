# M4 P2 最终整改执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 审核实现 SHA：`af7dae56f03515568e3b0d982d84601742fe2f9b`
>
> 整改执行基线：`af7dae56f03515568e3b0d982d84601742fe2f9b`
>
> 结论：**NO-GO；仅授权完成 P2-F03。**

## P2-F03 — 测试同步回调进入生产授权 service 契约

- **依据**：`AGENTS.md` 的最小充分实现与聚焦变更要求；P2-F01 的目的仅为修复锁顺序和提供回归证据，不应新增运行时测试控制面。
- **文件**：`src/modules/reflection-privacy/grant-private-access.service.ts`，以及 `tests/integration/reflection-privacy/reflection-privacy.test.ts`。
- **原因**：`GrantPrivateAccessInput.testHooks.beforeUserLock` 与 `RevokePrivateAccessInput.testHooks.afterUserLock` 是导出的生产输入字段，并在数据库事务、用户锁持有期间调用任意回调。虽然当前 Route 未传入它们，但同仓库调用者可引入等待、抛错或不可预测副作用，扩大了授权 service 的正式契约与事务风险。
- **修订动作**：从所有生产类型、输入和 service 实现中删除 `testHooks` 及对应运行时调用。保留 P2-F01 的锁顺序修复。将并发验证的同步控制完全置于测试侧（例如独立测试连接、测试本地事务/同步），或改为不需要生产钩子的稳定断言；不得以环境变量、全局变量、动态 import、any 转型或新的生产抽象替代该测试钩子。
- **验证方式**：P2-F01/P2-F02 均须继续可定位地证明：grant/end 后无 active grant、重新关联不恢复历史读取；撤权完成后 fresh read 被拒且错误不含正文。新增或调整的测试不得依赖 timing sleep。
- **允许范围**：仅上述 service 与 P2 reflection privacy 集成测试，以及为完全测试侧同步所必需的测试 helper。禁止修改 Route/UI/schema/迁移、其他模块契约、依赖、P1/M5/M6。

## 交付与质量门

1. 先确认工作区干净，严格以本指令 commit SHA 为执行基线；禁止 merge、rebase、reset、push。
2. 仅处理 P2-F03，并同步更新 `research/p2-implementation-record.md` 的整改说明与证据。
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

4. 提交一个聚焦整改 commit。回报必须包含：branch、完整 HEAD SHA、完整执行基线 SHA、已解决 ID、修改文件、每条命令的原始摘要、blocker。最后只能写：**“M4 P2 最终整改已交 Codex 审核（非 GO）。”**
