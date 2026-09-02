# M6 P2 集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> 审核对象：`a3d4bbafdce291009b6382d2a2082151f669e9cb`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 状态：**P2 NO-GO；只授权本文件 P2-F01～F07 集中整改，不授权 P3、归并、推送或部署。**

## 1. 开始前核验

Codex 与 Cursor 使用同一目录，不 pull/fetch，不切换分支或创建 worktree。确认 Prompt 指定的分支、完整 HEAD、上述审核 SHA 和干净工作区；不一致立即停止。不得 reset、rebase、stash、checkout 或处理他人变更。

本文件一次性列全当前审核的阻断项。不得改变 `p2-execution-directive.md` 的验收线，也不得顺手扩展 P3/UI/容量/恢复范围。

## 2. 集中整改项

### P2-F01：跨模块直接写权威表

- **依据**：P2-R01/R04 要求 Data Lifecycle 编排各模块清除；架构规范禁止跨模块直接写对方权威表。
- **位置**：`deletion-request.service.ts` 的 schedule、reflection/grant、training、identity/session 和 projection 直接 SQL/表写入，以及 tombstone replay 中的跨模块写入。
- **整改**：由 Identity、Family Access/Reflection、Schedule、Training、Projection 等权威模块暴露接受现有 `tx` 的冻结/清除/tombstone 重放 seam；Data Lifecycle 只按版本化步骤编排，不开嵌套事务。保持既有固定顺序和单步幂等。
- **证据**：模块边界测试或可定位 service 测试证明各 seam 在同一事务内执行；失败回滚、重试和重复重放保持不变量。

### P2-F02：资源级授权留在 Route

- **依据**：Route 必须薄；service 接收 actor 并负责资源级授权与不泄露存在性的错误语义。
- **位置**：export job download/status Route、deletion request detail Route 的 `get → route 比较 owner/admin`。
- **整改**：改为 actor-aware service API，在 service 内完成查找、授权及统一非枚举错误；Route 只解析、调用和映射响应。下载 service 本身也必须校验 requester，不能依赖调用方预查。
- **证据**：service 与 Route 覆盖 owner、非 owner、跨学生、admin 允许边界及统一 404/拒绝形状。

### P2-F03：导出 artifact 缺少已声明数据

- **依据**：R-M6-03 要求学生导出本人全部允许数据；snapshot 已声明 schedule/training，但生成内容没有这两部分。
- **位置**：`export-scope.service.ts` 与 `buildExportArtifactContent` 不一致。
- **整改**：按版本化 snapshot 实际生成 schedule 与 training 的最小结构化数据，并继续排除训练答案等不应导出的敏感正文；snapshot 未声明的 section 不得生成。家长范围仍受创建时上限与执行时实时授权约束。
- **证据**：断言最终下载 artifact 的每个 section 内容，而不只断言 snapshot 名称；覆盖学生、家长、私密 grant、撤权与冻结。

### P2-F04：账户冻结矩阵并未覆盖全部入口

- **依据**：P2-R01/R03 和 R-M6-04 要求身份、关系、训练、日程/事实、积分/兑换、总结、导出、首页/投影的普通读写全部冻结，并要求每个入口有 service/Route 证据。
- **现状**：测试只抽样 M4 读、M3 读、M2 读、M6 读、M5 写；重新登录/新 session、关系命令、日程创建更新、结算写、训练提交/趋势、首页/投影等未证明。
- **整改**：先枚举真实公共 service/Route 入口并补全矩阵；在最深且共享的服务边界接入统一 guard，避免只补 Route。冻结学生不得重新登录或创建 session；家长也不得通过仍存在的关系读取/写入其冻结数据。撤销后只恢复本次冻结影响的入口。
- **证据**：矩阵每格列出入口、guard 位置和具名测试；至少覆盖每个模块的读与写（如模块存在），以及 student/parent/cross-student/冻结撤销。

### P2-F05：账户清除与 tombstone 防复现不完整

- **依据**：P2-R01/R04、R-M6-05 要求撤销关系授权和 private grant，逐表清除 PII/正文，并在 tombstone 重放、旧事件/投影重建后不复现。
- **现状**：账户执行主要清除 reflection、training payload、部分 identity 与两个投影；未撤销家庭关系/private grant，字段矩阵也未覆盖所有可识别 payload。tombstone replay 仅重做 user/reflection，恢复的 training payload、关系/grant 可重新暴露。
- **整改**：以真实 schema 完成逐表字段矩阵，处理关系授权、private grants、身份可识别字段、训练/日程/事实与其他可识别 payload、未来执行及全部可重建投影；保留项必须说明无正文理由。tombstone replay 调用同一版本化模块 seam，至少重做身份最小化、授权撤销、正文清除与投影抑制。
- **证据**：canary 覆盖每个清除/保留字段；模拟恢复 training payload、关系/grant、session/artifact 和投影后先重放 tombstone，证明正文和授权不复现、账本/无正文审计仍一致。

### P2-F06：artifact 与 Worker 的故障/并发语义不成立

- **依据**：P2-R02/R04 要求失败不留半提交 artifact，并发领取/重试/dead replay 不重复可用 artifact 或副作用。
- **位置**：`processExportJob` 在数据库事务提交前执行外部 `artifactStore.put`；后续 DB/audit 失败会回滚 job 但遗留 artifact。现有 Worker 与 deletion replay 测试均为顺序重复调用。
- **整改**：明确数据库状态与外部 artifact 的可恢复协议（临时/最终 key、补偿 purge 或等价最小方案），确保失败后无可访问孤儿 artifact；并发领取只有一个 worker 获得首次结果/一次 token。删除步骤在外部 revoke/purge 与数据库 step marker 之间也要采用可重试、fail-closed 的明确语义。
- **证据**：两个独立连接真实并发领取；`put` 后 DB/audit 故障注入；artifact store put/open/revoke/purge 故障；重试后仅一个可用 artifact/token。删除 Worker 做真实并发、步骤中断与 dead replay，终态和副作用唯一。

### P2-F07：创建幂等未校验 payload，且并发可能 500

- **依据**：P2-R02/R03 要求任务/请求幂等，schema 已保存 payload hash。
- **位置**：`createExportJob` 与 `createDeletionRequest` 通过 audit 找到 replay 后直接成功，不比较已存 payload hash；两个并发首次请求仍可能撞唯一约束并返回数据库错误。
- **整改**：相同 actor+key+规范化 payload 安全重放；同 key 不同 student/role/target 返回 `IDEMPOTENCY_CONFLICT`。使用不会继续操作 aborted transaction 的并发 upsert/replay 方案，并确保业务事实、audit、outbox 只有一套。
- **证据**：export/deletion 各覆盖同 payload 顺序重放、不同 payload 冲突、两个独立连接同 payload 并发收敛、不同 payload 并发冲突，以及事实/audit/outbox 唯一。

## 3. 非阻断项

- Data Lifecycle 大文件的职责密度、Route 测试重复和同模块 dynamic import 可在上述整改自然涉及时改善，但不得单独扩展重构。
- `m5-concurrency.test.ts` 的既有 advisory-lock 观测超时先按共享环境问题记录；本轮需在无并发 runner 条件下单独复跑后如实报告，除非能稳定复现并证明由 P2 guard 引起，否则不作为 P2 阻断。

## 4. 验证与提交

更新 `p2-implementation-record.md` 的冻结/清除矩阵与 F01～F07 测试映射。无其他 runner 时串行运行：

```bash
pnpm db:migrate
pnpm test tests/integration/data-lifecycle tests/integration/migrations tests/integration/api tests/integration/identity tests/integration/family-access tests/integration/reflection-privacy tests/integration/schedule tests/integration/training tests/integration/settlement tests/integration/projection tests/integration/redemption tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
```

再单独串行复跑 `tests/integration/training/m5-concurrency.test.ts`，最后运行 `pnpm test`。不得并行运行共享数据库测试；环境/时长阻断必须记录原始结果。

整改只提交一个聚焦 commit。回报完整 `branch`、`HEAD`、`remediation_base`、F01～F07、修改文件、矩阵位置、真实并发/故障证据、原始验证摘要与 blocker。最后一句必须是：

**“M6 P2 集中整改已交 Codex 复验，未启动 P3，未归并、未推送、未部署。”**
