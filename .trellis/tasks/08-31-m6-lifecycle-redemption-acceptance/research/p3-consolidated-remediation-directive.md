# M6 P3 集中整改指令（NO-GO）

## 固定信息

- Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
- 分支：`feat/m6-lifecycle-redemption-acceptance`
- 被审提交：`90a347f108622e36798bd49e14adbdcae87959a6`
- 整改基线：以包含本文件的 Codex 提交完整 SHA 为准
- 原执行指令：`research/p3-execution-directive.md`
- 结论：**NO-GO**。本文件冻结全部阻断项；不得移动验收线或扩大范围。

## 阻断项

### P3-C01：恢复 Worker 边界，移除浏览器同步处理导出

`src/app/api/export-jobs/[jobId]/process/route.ts` 允许请求方同步调用 `processExportJob` 并取得下载令牌，违反独立 Worker、薄 Route 与既有 P2 导出契约。

整改：

- 删除用户可调用的 process Route 及对应客户端/UI/E2E helper 调用。
- UI 只创建任务、轮询授权后的状态并下载；导出处理由既有或新增的独立 Worker 入口完成。
- Worker 领取、重试、幂等、token 生成继续复用 P2 service 契约；不得把 Worker 权限暴露给浏览器。
- 增加 Route/E2E 证据，证明请求方不能触发 Worker 处理或取得未授权处理能力。

### P3-C02：提供持久私有 artifact adapter，内存实现仅限测试

`route-artifact-stores.ts` 使用进程内存保存可下载 artifact；进程重启或多实例会产生数据库 `ready` 但 artifact 丢失的不一致。

整改：

- 通过现有 `PrivateArtifactStore` seam 增加供应商无关、持久且私有的本地 adapter，供应用与 Worker 共享；不得引入云 SDK。
- 存储根目录必须显式配置、默认拒绝不安全配置，防路径穿越；artifact 不进入 Git，日志/错误不得输出正文、token 或私有路径。
- 原子写入并保持 put/get/delete 的失败语义；内存 adapter 只用于测试。
- 增加聚焦测试覆盖跨 adapter 实例读取、删除、重启等价行为、非法 key/路径以及失败时 job 不错误进入可下载状态。

### P3-C03：补齐容量指标

`capacity-synthetic.mts` 当前将删除吞吐固定为 `null`，且没有慢查询和资源边界测量，未满足 P3-R02/AC-M6-08。

整改：

- 对每个可选 tier 输出连接、队列、慢查询、导出吞吐、删除吞吐、总耗时和明确的资源指标/边界。
- 指标无法从当前环境可靠取得时，输出结构化 `unavailable` 及原因，不得用 `null` 冒充测量；验收记录据此标为 deferred/blocker。
- 为 tier 解析、安全保护和指标字段增加自动化测试；仍只实际运行本机可承受的档位，1,000/10,000 可如实 deferred。

### P3-C04：恢复演练必须包含备份/恢复和完整 canary

当前脚本只在同一数据库内改写两行模拟泄漏，不是备份/恢复；缺少授权矩阵、兑换和未删除历史 canary。

整改：

- 在隔离合成数据库中创建可识别的备份/恢复步骤或等价数据库级快照恢复，明确记录 restore 完成后才执行 tombstone/撤权重放，再重建投影。
- canary 至少验证：已删正文不可复现、已撤授权不可恢复、未删除授权矩阵正确、余额一致、兑换历史一致、未删除正文/身份历史一致。
- 失败必须使脚本非零退出；所有目标继续受 fail-closed 合成环境保护。

### P3-C05：记录真实、可解释的 RPO 与 RTO

当前只输出 `rtoMs` 和泛化说明，没有实际 RPO。

整改：

- 定义本演练的恢复点、水位或可恢复事件边界，计算并输出实际观测 RPO；同时保留各阶段与总 RTO。
- 输出测量方法、时间戳/水位、单位和非生产声明；无法测量不得把 AC-M6-07 标为通过。

### P3-C06：补齐真实 UI E2E 矩阵并纠正验收账务

当前没有过期 token 路径；终态冲突和冻结态只有 API 断言；兑换、导出、删除的若干“UI 主路径”由 helper 直接调用 API，不能证明 UI 状态反馈。

整改：

- 在 desktop Chromium 与 360×800 上，通过页面交互覆盖学生兑换/撤销、家长目录管理/批准/拒绝、导出创建/状态轮询/下载、删除请求/撤销/学生确认。
- 通过 UI 断言成功、越权不泄露、终态冲突、过期 token、已消费 token、冻结态、危险确认、loading/失败/终态反馈和无横向滚动。
- API helper 只允许用于夹具准备或制造难以等待的前置状态，不能替代被验收 UI 行为；实施记录明确区分夹具与 UI 断言。
- 修正 `p3-implementation-record.md`：在上述证据闭合前，AC-M6-07/09 不得标为通过；容量未实测档位和全量测试既有失败继续如实记录。

## 验证与提交

至少执行并记录：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

另执行新增的持久 artifact、容量保护/指标、恢复演练聚焦测试，以及本机安全可承受的容量与恢复命令。不得为通过测试削弱授权、Worker、冻结、tombstone 或一次性 token 契约。

Codex 与 Cursor 使用同一目录，不要 pull/fetch、切分支或创建 worktree。整改完成后只做一次聚焦整改提交；不得修改任务状态、签署文件或自行 GO。

## 回报格式

回报分支、完整 HEAD、完整整改基线、逐项 P3-C01～C06 证据、修改文件、原始验证摘要、容量/恢复实际结果和剩余 blocker/deferred，结尾写“已交审核”。
