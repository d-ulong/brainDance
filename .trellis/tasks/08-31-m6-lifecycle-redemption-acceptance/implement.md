# M6 实施计划

## 固定信息

- Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
- 目标分支：`feat/m6-lifecycle-redemption-acceptance`
- 规划基线：`main@b23eb1f2cb77ba6b26fe5b47e7ce8febf2166dc0`
- 交付方式：Cursor 串行执行唯一单阶段指令；每阶段提交后由 Codex 固定 SHA 审核。

## P1：兑换目录、申请与唯一扣减（已签署 GO：`064842a74bee0d683f01334b5cce70a881ec4cbc`）

- [ ] 先写 migration/schema 约束测试，新增目录与申请权威表、状态约束、幂等字段和唯一 ledger 关联。
- [ ] 实现目录创建/读取/更新/停用及配置所有权；扩展离关联停用与 pending 申请取消。
- [ ] 实现学生申请/撤销与家长批准/带理由拒绝，固定锁顺序并在同事务写 ledger、余额、audit/outbox。
- [ ] 覆盖价格快照、月限次、余额不足/负数、越权、幂等重放、payload 冲突、批准/拒绝/撤销并发。
- [ ] 增加薄 Route 与类型化 DTO/错误映射；P1 不做产品 UI。
- [ ] 写 `research/p1-implementation-record.md`，逐项映射 R-M6-01～02、AC-M6-01～02 和原始验证摘要。

P1 验证：

```bash
pnpm db:migrate
pnpm test tests/integration/migrations tests/integration/settlement tests/integration/redemption tests/integration/api tests/integration/family-access tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
```

P1 禁止：导出、删除/tombstone、UI、容量/恢复脚本、供应商 SDK、依赖升级、merge/rebase/reset/push/deploy。

## P2：授权导出、账户级删除与 tombstone（已签署 GO：`761df5365e3f31fdb83d507c1cc1250751ed2cd0`）

- [ ] 建立逐 Route/service/表的冻结与清除矩阵，先写缺口失败测试。
- [ ] 新增 export jobs、deletion requests/tombstones、状态与幂等约束；实现私有 artifact seam 和测试 adapter。
- [ ] 实现学生/家长导出 scope snapshot、Worker 生成、二次授权、一次性 24 小时 token 与撤销/清除。
- [ ] 实现独立内容与学生账户删除的申请、冻结、撤销、学生确认和管理员强制执行审计。
- [ ] 将账户冻结 guard 接入 M1–M5 所有读取/写入边界，撤销 session、授权和 artifact。
- [ ] 实现版本化清除步骤、字段级最小化、tombstone 幂等重放与 dead replay；证明不可变账本/无正文审计仍一致。
- [ ] 写 `research/p2-implementation-record.md`，包含授权矩阵、字段清除矩阵、重试时序和 AC-M6-03～06 证据。

P2 验证：

```bash
pnpm db:migrate
pnpm test tests/integration/migrations tests/integration/data-lifecycle tests/integration/redemption tests/integration/api tests/integration/family-access tests/integration/reflection-privacy tests/integration/training tests/integration/schedule tests/integration/settlement tests/integration/projection tests/integration/outbox tests/integration/audit tests/integration/identity
pnpm typecheck
pnpm lint
pnpm format
```

P2 禁止：产品 UI、真实云对象存储、生产数据/备份、容量宣称、M7/M8、无关重构、依赖升级、merge/rebase/reset/push/deploy。

## P3：UI、容量与恢复联合验收（已签署 GO：`e2abff52c496f53e81d1442145f5bc75ebd6b28a`）

- [ ] 完成学生兑换/撤销、家长目录/审批、导出状态/下载和删除请求/撤销/确认 UI。
- [ ] desktop Chromium 与 mobile-360 覆盖成功、越权、终态冲突、过期 token、冻结和危险操作确认；验证无横向滚动。
- [ ] 建立仅合成数据的 100/1,000/10,000 家庭容量脚本，记录连接、队列、慢查询、导出/删除吞吐与资源边界。
- [ ] 建立隔离恢复演练：备份恢复、先重放 tombstone/撤权、重建投影、正文/授权 canary 验证，记录实际 RPO/RTO。
- [ ] 汇总 AC-M6-01～10 验收矩阵、上线 blockers、监控指标和回滚说明。
- [ ] 写 `research/p3-implementation-record.md`，未执行项不得表述为通过。

P3 验证：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

容量与恢复命令由 P3 指令在脚本落地后固定；只能指向隔离的合成环境。P3 禁止部署生产、复制生产数据、绑定云供应商、关闭法律/供应商上线 blocker、M7/M8、依赖升级、merge/rebase/reset/force-push。

## 审核与回滚点

每阶段只提交一个聚焦 commit，并按固定格式回报 branch、完整 HEAD、完整执行基线、已解决 R/AC、修改文件、原始验证命令摘要和 blocker。Cursor 只能声明“已交审核”。

P1 数据不变量或锁顺序不成立，不得进入 P2。P2 冻结矩阵、字段清除矩阵、恢复重放或正文防复现证据不完整，不得进入 P3。任何演练误指向非合成环境必须立即停止。
