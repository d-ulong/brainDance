# M6 P2 E01 最终崩溃一致性修正

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> 审核对象：`659ccbfa9f76c895f0557b34f353b65153ab0336`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 状态：**仅授权 E01-R01～R02；不修改其他 P2/P3 内容。**

## E01-R01：purge intent 必须与 job revoke 原子持久化

当前 replay 在数据库事务内撤销 export job，提交后才 purge 或记录 pending keys。若进程在事务提交与记录 pending 之间退出，下一次 replay 已无法从 revoked job 找回 artifact key，实体正文可能永久遗留。

修正为：在同一数据库事务中收集 artifact keys、撤销 job/token，并把 dedupe 后的 purge intent 持久化到可靠状态；事务提交后才执行外部 purge，成功后清除 intent。任何进程退出点都必须满足：job/token fail-closed，且下一次 replay 能从持久状态恢复全部待清除 keys。

测试必须通过可控 hook/fault 在“数据库提交后、外部 purge 前”中断，随后重新调用 replay，证明无需读取 ready job 也能物理清除 artifact 并清空 intent。

## E01-R02：损坏的 purge intent 必须 fail-closed

`artifactPurgePendingKeys` 无法解析或结构非法时，不得静默返回空数组。抛出类型化错误并保留原状态，禁止继续报告 tombstone 已完整应用；错误修复/恢复为有效状态后可重试收敛。

测试覆盖 malformed JSON、非字符串数组元素或其他非法结构，断言 artifact 未被误判为已清除、job/token 仍 revoked、错误可定位且没有 audit/outbox 重复。

## 验证与提交

只修改 E01 crash-consistency 所需 service、测试和实施记录。串行运行：

```bash
pnpm db:migrate
pnpm test tests/integration/data-lifecycle/e01-tombstone-artifact-purge.test.ts tests/integration/data-lifecycle tests/integration/migrations/m6-schema-constraints.test.ts
pnpm typecheck
pnpm lint
pnpm format
```

提交一个聚焦 commit，回报完整 `branch/HEAD/fix_base`、R01/R02 测试名称与原始验证摘要。最后一句：

**“M6 P2 E01 崩溃一致性修正已交 Codex 复验，未启动 P3，未归并、未推送、未部署。”**
