# M6 P2 生产风险闭合指令：恢复后 artifact 物理清除

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> 审核对象：`ced9d53d823e3e69ba0168668b69701b2e17b093`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 状态：**仅授权 E01；不再补普通验收矩阵，不授权 P3、归并、推送或部署。**

## E01：tombstone replay 必须清除恢复后的实体 artifact

### 风险

`applyTombstonesBeforeProjectionRebuild` 当前只能把恢复后的 `export_jobs` 标成 revoked，没有 `PrivateArtifactStore`/purge 通道。若备份同时恢复了 artifact 实体，数据库虽拒绝下载，正文仍保留在私有存储，违反 R-M6-05/AC-M6-06 的删除防复现要求。这是三轮验收线审计后唯一保留的生产级隐私阻断项。

### 修正

- tombstone replay 在数据库事务内收集被撤销 job 的 opaque artifact keys；事务成功后通过明确的 artifact purge seam 物理清除。
- purge 失败必须保持 fail-closed，并留下可持久重试/可定位状态；不得把失败表述为 tombstone 已完整应用，也不得重新开放 job/token。
- 重放仍需幂等：artifact 已不存在、重复 tombstone 或重复 purge 均安全收敛。
- 不修改已闭合的 C01～C07 其他实现，不补非阻断测试矩阵，不做无关重构。

### 必须证据

1. 执行删除后，模拟同时恢复 `export_jobs` 为 ready、token/artifact key，以及将真实 canary artifact 重新写入 store；tombstone replay 后 job/token 不可用且 store 中 artifact 不存在。
2. purge 故障注入证明 job 持续 fail-closed，并记录可重试状态；解除故障后重放成功清除。
3. 重复 replay/purge 无异常、无重复 audit/outbox 或授权恢复。

## 验证与提交

更新 `p2-implementation-record.md` 的 E01 映射，串行运行：

```bash
pnpm db:migrate
pnpm test tests/integration/data-lifecycle tests/integration/migrations/m6-schema-constraints.test.ts
pnpm typecheck
pnpm lint
pnpm format
```

只提交一个聚焦修正 commit。回报完整 `branch/HEAD/emergency_base`、修改文件、三条测试证据、原始验证摘要和 blocker。最后一句必须是：

**“M6 P2 E01 生产风险闭合已交 Codex 复验，未启动 P3，未归并、未推送、未部署。”**
