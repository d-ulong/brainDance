# M6 P2 Cursor 执行指令：授权导出、账户级删除与 tombstone

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> P1 签署 SHA：`064842a74bee0d683f01334b5cce70a881ec4cbc`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 状态：**只授权 P2；不授权 P3、归并、推送或部署。**

## 1. 开始前核验

Codex 与 Cursor 使用同一目录，不 pull/fetch，不切换分支或创建 worktree。确认 Prompt 指定的分支、完整 HEAD、执行基线和干净工作区；不一致立即停止。不得 reset、rebase、stash、checkout 或处理他人变更。

先阅读本任务 `prd.md`、`design.md`、`implement.md`，以及 `.trellis/spec/backend/` 中 database、error、logging、quality 与 directory 规范。本文件是 P2 唯一执行授权；冲突时以 PRD 冻结的 R-M6-03～06、AC-M6-03～06 为验收线。

## 2. P2-R01：冻结与清除矩阵先行

- 在 `research/p2-implementation-record.md` 建立逐 Route/service/表字段矩阵，覆盖身份/会话、关系授权、训练答案与事件正文、日程/事实、结算/账本、兑换、总结、导出、首页与可重建投影。
- 每格标明冻结时读/写行为、执行删除后的清除/保留/去标识规则、tombstone 重放行为及测试名称；先为未覆盖入口写失败测试。
- 不可变账本金额/来源类别、无正文安全审计和完整性必需键可保留；PII、私密总结、训练答案、可识别 payload、token/artifact 必须清除或去标识。

## 3. P2-R02：导出任务与私有 artifact

- 新增 `export_jobs` 所需 migration/schema、状态/幂等/过期约束和版本化 `scope_snapshot`。snapshot 只记录范围与授权版本，不保存正文。
- 学生只能导出本人允许数据；家长只可创建当前有效关系范围内的任务，私密总结逐资源校验 grant。Worker 执行和下载时再次检查冻结、关系/授权纪元；创建时 snapshot 是上限，后续撤权优先。
- 实现最小 `PrivateArtifactStore` seam（put、open-once、revoke、purge）及测试 adapter；不得绑定云 SDK。数据库只保存 opaque artifact key 与 token hash。
- 下载令牌明文只在创建/就绪交付边界出现一次，24 小时过期且必须原子单次消费。撤权、冻结、删除、过期或已消费均拒绝旧 artifact；日志、审计、错误不得包含正文、token、链接或 artifact 内容。
- job/Worker 重试、并发领取和 dead replay 不得重复生成可用 artifact 或重复副作用；业务事实、audit/outbox 同事务。

## 4. P2-R03：删除请求、冻结与确认

- 新增版本化 `deletion_requests`、`deletion_tombstones` 及必要步骤状态/幂等约束；target 至少支持独立每日总结与 student account。
- 生命周期为 `requested/frozen/cancelled/executed`。请求后服务端立即冻结相关普通读取和新业务写入，并撤销学生 session 与现有私有下载；禁止只在 UI 或 Route 某一层判断。
- 30 天内合资格发起者可撤销。涉及学生数据的最终执行必须由学生本人确认；管理员强制执行只能走受控 service 参数，必须记录原因和安全审计，不增加普通管理员浏览/代办 Route。
- 撤销只恢复本次冻结的业务入口，不自动恢复已解除关系、已撤销 grant 或其他独立失效配置。

## 5. P2-R04：版本化清除、tombstone 与防复现

- Worker 固定顺序：撤销 session/artifact → 停止未来日程与配置 → 清除总结/训练答案等正文 → 最小化身份字段与可识别引用 → 清理可重建投影 → 写/确认 tombstone → 标记 executed。
- 每步以 `(deletion_request_id, step_version)` 幂等；重复执行、失败重试、并发领取、dead replay 与重复 tombstone 均不得重复副作用。
- tombstone/撤权必须能在普通投影重建前重放；投影重建、旧 outbox/worker replay 或恢复输入不得复现已删正文或授权。
- 用真实 PostgreSQL 约束、事务故障注入和并发测试证明清除原子边界；完整保留无正文最小审计与账本不变量。

## 6. 必须具名的验收证据

测试至少可定位证明：

1. 学生/家长导出内容矩阵，以及家长跨学生、关系解除、grant 撤销、冻结后的拒绝；
2. 私密总结按资源 grant 包含/排除，scope snapshot 不含正文；
3. token 仅哈希存储、一次性并发消费、24 小时边界、过期/撤权/冻结/删除拒绝；
4. Worker 重试/并发领取只留一份可用 artifact，失败不留下半提交事实；
5. 独立内容与整账户请求、即时冻结、30 天撤销边界、学生确认、管理员强制原因/审计；
6. 冻结矩阵中每个 M1～M5 读写入口均有 service/Route 证据，且跨学生资源存在性不泄露；
7. 字段清除矩阵逐表验证 PII/正文消失、账本与无正文审计保留；
8. 重复执行、并发执行、dead replay、tombstone 重放和投影重建后正文不复现、授权不恢复。

## 7. 允许范围、禁止项与验证

允许新增/修改 Data Lifecycle、导出/下载、冻结 guard、Worker、必要的 M1～M5 接入点、migration/schema、测试 adapter、对应 Route/DTO、audit/outbox 与 P2 实施记录。对既有模块的修改仅限接入统一 guard、清除 seam 和验收所需最小改动。

禁止产品 UI、真实云对象存储/生产数据/备份、容量或合规保证、P3/M7/M8、依赖升级、无关重构，以及 merge/rebase/reset/push/deploy。

无其他 runner 时串行执行：

```bash
pnpm db:migrate
pnpm test tests/integration/migrations tests/integration/data-lifecycle tests/integration/redemption tests/integration/api tests/integration/family-access tests/integration/reflection-privacy tests/integration/training tests/integration/schedule tests/integration/settlement tests/integration/projection tests/integration/outbox tests/integration/audit tests/integration/identity
pnpm typecheck
pnpm lint
pnpm format
```

再串行运行 `pnpm test`。共享数据库测试不得与其他 runner 并发；未执行或环境阻断项必须如实记录。

## 8. 提交与回报

P2 只提交一个聚焦业务 commit，包含实现、测试和 `p2-implementation-record.md`。回报：

```text
branch: <分支>
HEAD: <完整 SHA>
execution_base: <Prompt 指定完整 SHA>
resolved: P2-R01 ... P2-R04 / AC-M6-03 ... AC-M6-06
changed_files:
- <文件>
export_evidence:
- <scope/token/artifact/worker 测试映射>
deletion_evidence:
- <冻结/确认/清除/tombstone 测试映射>
matrix_evidence:
- <Route/service/字段矩阵位置>
verification_raw_summary:
- <命令与原始摘要>
blockers:
- <无则 none>
```

最后一句必须是：**“M6 P2 已交 Codex 审核，未启动 P3，未归并、未推送、未部署。”**
