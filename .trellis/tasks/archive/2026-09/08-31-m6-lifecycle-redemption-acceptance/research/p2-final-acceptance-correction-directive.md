# M6 P2 最终验收修正 Cursor 执行指令

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> 最终复验对象：`8b83c648df16ff30c57d5c11bde488ac4ab71ade`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 状态：**P2 NO-GO；验收线审计后仅授权 C01～C07，不授权 P3、归并、推送或部署。**

## 1. 执行边界

双方使用同一目录，不 pull/fetch，不切换分支或创建 worktree。确认 Prompt 指定分支、HEAD、审核 SHA 和干净工作区；不一致立即停止。不得修改 P1、P3/UI/容量/恢复或新增产品能力。

本轮是 P2 最后一次修正，只闭合下列既有要求；完成后 Codex 只按本清单复核。

## 2. 最终修正清单

### C01（F01）：修正残留跨模块写入

`family-access/account-deletion.service.ts` 只处置 Family Access 拥有的 relationship，不得读写 Reflection Privacy 的 `dailyReflections/privateAccessGrants`。grant 撤销与 replay 完全归属 `reflection-privacy/account-deletion.service.ts`，Data Lifecycle 在同一 `tx` 中分别调用两个 seam。增加边界/行为证据。

### C02（F02）：闭合 actor 授权矩阵

补齐 service 与 Route 的具名证据：export status/download 的 owner、非 owner、parent 跨学生；deletion detail/cancel/confirm 的 student owner、非 owner、跨学生及 admin 明确允许边界；所有未授权资源保持统一非枚举错误。必须直接测试 download service 不依赖 Route 预查。

### C03（F03）：验证真实导出内容

为 student 与 parent 实际种入 schedule、training summary、normal/private reflection 等数据，下载并断言每个 snapshot section 的字段内容和排除项；覆盖 private grant 有/无、Worker 前撤权、冻结拒绝。不得只断言 section `defined` 或字符串不含关键词。

### C04（F04）：补齐冻结入口证据

在实施矩阵中逐项列出并测试当前仍缺的公共入口：session validation/new session、relationship command、homepage/聚合 projection 读；同时为矩阵中声称已覆盖但没有具名测试的训练提交/读取、日程读写、积分读写等补上测试映射。每个存在读写能力的 M1～M6 模块至少有真实 service/Route 读写证据；cancel 后恢复仍需验证。

### C05（F05）：真实模拟恢复后重放

先执行账户删除，再人为恢复 canary：student PII/status、session、active relationship、private grant、reflection body、training payload、pending schedule、artifact/job 可用状态及可重建投影；随后执行 tombstone replay。重放必须通过模块 seam 再次最小化身份、撤销 session/relationship/grant/artifact、清除正文/payload、取消未来执行并抑制/重置投影。证明账本与无正文审计保持一致。

### C06（F06）：消除 `ready-before-put` 竞态并补齐故障矩阵

- 不得在 artifact 成功落地前对外提交 `ready` 和可下载 token。采用明确的 `processing → 外部 put → 最终 ready` 可恢复协议；进程在任一步退出后，重试能继续或安全清理，不留下永久 `ready` 无文件、孤儿 artifact 或多个 token。
- 两个独立连接使用同一共享 store 做真实并发领取，断言仅一个可用 artifact/token；并验证并发下载。
- 覆盖 put 后最终 DB/audit 失败，以及 store `put/open/revoke/purge` 故障；断言状态可恢复且无越权可用文件。
- 删除 Worker 覆盖两个独立连接并发、每个关键步骤中断后重试、外部 purge/revoke 故障和 dead replay，终态/step/audit/outbox/外部副作用唯一且 fail-closed。

### C07（F07）：补齐两类创建幂等矩阵

export 与 deletion **各自**覆盖：同 payload 顺序重放、不同 payload 冲突、两个独立连接同 payload 并发收敛、两个独立连接不同 payload 并发一成一冲突；逐类断言事实、audit、outbox 仅一套。不得用另一类命令的测试代替。

## 3. 验证与提交

更新 `p2-implementation-record.md`，对 C01～C07 逐条列出测试名称，禁止只写文件名或“全绿”。无其他 runner 时串行执行：

```bash
pnpm db:migrate
pnpm test tests/integration/data-lifecycle tests/integration/migrations tests/integration/api tests/integration/identity tests/integration/family-access tests/integration/reflection-privacy tests/integration/schedule tests/integration/training tests/integration/settlement tests/integration/projection tests/integration/redemption tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
```

共享数据库测试不得并行。`m5-concurrency.test.ts` 仍单独串行复跑并如实记录；除非证明 P2 引起，否则不扩成本轮整改。

只提交一个聚焦修正 commit。回报完整 `branch/HEAD/correction_base`、C01～C07 修改与测试映射、原始验证摘要和 blocker。最后一句必须是：

**“M6 P2 最终验收修正已交 Codex 复验，未启动 P3，未归并、未推送、未部署。”**
