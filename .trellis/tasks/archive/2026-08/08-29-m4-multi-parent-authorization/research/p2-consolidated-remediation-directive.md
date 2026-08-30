# M4 P2 集中整改执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 审核实现 SHA：`a5039a3ec647c474a36cf671cab4cea51618da63`
>
> 整改执行基线：`cb003237605ae374d4fff4f2c948bb590b6b2acc`
>
> 结论：**NO-GO；仅授权完成以下 P2-F01、P2-F02 整改。**

## P2-F01 — grant 与关系结束存在 TOCTOU，可能遗留有效 grant

- **依据**：`planning-summary.md` 的 frozen scope 第 3 点和 AC-M4-3/AC-M4-5 要求：结束关系须同事务撤销目标 parent 的私密 grant；重新关联不得恢复旧 grant；并发不得破坏授权不变量。
- **文件**：`src/modules/reflection-privacy/grant-private-access.service.ts` 的 `grantPrivateAccess`。
- **原因**：当前事务先调用 `hasActiveRelationship`，随后才对 parent/student 执行 `FOR UPDATE`。如果 grant 在关系检查后被暂停，`endRelationship` 可先取得同一对用户锁、结束关系并撤销既有 grants；grant 恢复后仍会取得锁并插入新的 active grant。之后重新关联时，这个不应存在的历史 grant 会恢复可读性。
- **修订动作**：在同一事务内，以与 `endRelationship` 一致的稳定顺序先锁定 student 和 parent，再查询当前 active relationship 并决定是否创建 grant。不得仅依赖先前的关系检查或数据库唯一索引。保持 idempotency、epoch、audit/outbox 现有语义。
- **验证方式**：新增确定性的双独立连接并发回归：grant 已完成关系前置读取但尚未取得用户锁时执行 end；最终必须没有 active grant，结束后 grant 必须失败或被结束流程撤销；随后重新关联仍不得读取这条历史 private reflection。测试必须证明无正文泄露。
- **允许范围**：仅 `grant-private-access.service.ts` 及反射隐私/家庭关系相关集成测试；为实现确定性同步而新增的最小测试 helper 可纳入。

## P2-F02 — 缺少 AC-M4-4 指定的并发读/撤权无泄露证据

- **依据**：`planning-summary.md` 的 AC-M4-4 明确要求“逐项撤销、关系结束和并发读/撤权均无正文泄露”；P2 implementation record 当前只列出顺序的 revoke session 回归。
- **文件**：`tests/integration/reflection-privacy/reflection-privacy.test.ts`（或等价且可定位的 P2 专用集成测试）。
- **原因**：现有 P2-R02/P2-05 证明撤权前后读取与 epoch 刷新，但未覆盖读请求与 revoke 交错时，撤权完成后的可见结果和错误响应不含正文。
- **修订动作**：加入可重复、无时间猜测的并发/交错测试，覆盖 private reflection 已授权 parent 的读取与 student revoke 交错；断言撤权完成后 fresh session/read 为拒绝，响应/错误序列化不包含 reflection body。保留现有顺序回归。
- **验证方式**：运行 P2 reflection privacy 集成测试和 API route 测试；完整质量门仍须在隔离 Docker PostgreSQL、无并发 runner 下串行执行。
- **允许范围**：仅 P2 reflection privacy/API 测试及为该测试最小必要的同步 helper；不得调整产品行为、扩展 Route 或修改 P1/M5/M6。

## 交付与质量门

1. 先确认工作区干净，并以本指令提交 SHA 为唯一执行基线；不得改写历史、merge、rebase、reset、push。
2. 只处理 P2-F01、P2-F02；禁止任何无关重构、依赖升级、迁移/schema/UI 扩展。
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

4. 更新 `research/p2-implementation-record.md`：列出 P2-F01/P2-F02、测试定位及完整质量门原始摘要。
5. 提交一个聚焦整改 commit。回报必须包含：branch、完整 HEAD SHA、完整执行基线 SHA、已解决 ID、修改文件、每条命令的原始摘要、blocker。最后只能写：**“M4 P2 整改已交 Codex 审核（非 GO）。”**
