# M6 P1 集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> 审核对象：`5544b9979c7e4168dacfdf2bd5a67543561ea6f5`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 状态：**P1 NO-GO；只授权本文件 R01～R06 集中整改，不授权 P2/P3、归并、推送或部署。**

## 1. 开始前核验

Codex 与 Cursor 使用同一目录，不 pull/fetch，不切换分支或创建 worktree。运行：

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
git merge-base --is-ancestor 5544b9979c7e4168dacfdf2bd5a67543561ea6f5 HEAD
```

必须位于目标分支、工作区干净且 HEAD 包含审核 SHA；不一致立即停止。不得 reset、rebase、stash、checkout 或清理文件。

## 2. 审核结论与依据

### P1-F01 目录写入缺少事务原子性（阻断）

- **依据**：P1-R04 要求业务事实、audit/outbox 同事务；`.trellis/spec/backend/database-guidelines.md` 禁止先提交事实再尽力入队。
- **位置**：`src/modules/redemption/catalog.service.ts:111-158,277-300`。
- **问题**：create 先插入再分别追加 audit/outbox；update 先更新再追加 audit，且没有 outbox。后续失败会留下无审计/事件的已提交业务状态。
- **整改**：让 create/update 的权威写入、幂等 replay、audit 与版本化最小 outbox 在同一个 `db.transaction` 内完成；并发唯一冲突在事务内/冲突后安全重放。update 事件需使用稳定 dedupe key，不泄露正文。
- **验证**：故障注入证明 audit 或 outbox 插入失败时目录事实回滚；正常/重放只产生一套事实、audit、outbox。

### P1-F02 关系模块直接写兑换权威表（阻断）

- **依据**：`design.md` §1 要求跨模块不直接写对方权威表；backend directory guideline 禁止 direct cross-module table writes。
- **位置**：`src/modules/family-access/deactivate-creator-configs.service.ts:131-240`。
- **问题**：Family Access 直接查询/更新兑换目录和申请，造成模块边界与不变量分散。
- **整改**：在 Redemption 模块暴露接受现有 `tx` 的关系结束处置接口，由 Family Access 只调用该接口；兑换模块拥有目录停用、pending 取消、audit/outbox 与幂等规则。不得开启嵌套事务。
- **验证**：关系结束原子事务仍覆盖关系、兑换处置、audit/outbox；双 parent/双 student 与重放不误停其他配置。

### P1-F03 学生可读取 inactive 目录项（阻断）

- **依据**：P1-R02：“学生只读 active 项”；R-M6-01。
- **位置**：`src/app/api/family/students/[studentId]/redemption-catalog/route.ts:15-25`、`catalog.service.ts:303-318`。
- **问题**：任何调用者省略 `activeOnly=true` 都可读取 inactive；客户端 query 被误当授权策略。
- **整改**：服务端根据角色强制学生仅 active。当前有效家长可按冻结 DTO 契约读取允许的目录历史；客户端参数不得扩大权限。
- **验证**：学生省略/伪造 query 均不返回 inactive；创建家长、其他有效家长、解除家长和跨学生矩阵有 Route 证据。

### P1-F04 update/reject 未校验幂等 payload（阻断）

- **依据**：P1-R03：“相同 key+payload 重放；不同 payload 冲突”。
- **位置**：`catalog.service.ts:213-235,287-297`；`redemption.service.ts:91-110,535-551`。
- **问题**：update/reject replay 只比较 resource ID；同 key 改目录更新内容或拒绝理由仍作为成功重放。
- **整改**：为每类命令使用规范化 payload hash，并在首次提交的权威命令记录或类型化 audit metadata 中保存；重放必须同时比较命令类型、资源与 payload hash。不同 payload 返回 `IDEMPOTENCY_CONFLICT`，不得泄露旧 payload。
- **验证**：update/reject 同 key 同 payload 重放；同 key 不同字段/理由冲突且无额外状态、audit/outbox。

### P1-F05 批准锁顺序偏离冻结设计（阻断）

- **依据**：`design.md` §2 与 P1-R04 固定“申请 → 余额 → 月限次”锁序。
- **位置**：`redemption.service.ts:430-465`。
- **问题**：当前顺序是申请 → 月度行 → student/余额，增加与其他余额写入形成锁序反转的风险。
- **整改**：严格改为申请行 → 学生/余额锁 → 月限次相关行；所有批准路径只使用这一顺序，并用注释/共享 helper 固定。
- **验证**：真实并发批准×批准、批准×拒绝、批准×撤销、月限次竞争均在超时内收敛，无死锁、重复终态或重复流水。

### P1-F06 强制验收矩阵缺失（阻断证据）

- **依据**：P1 指令 §4；AC-M6-01/02 要求权限、月限次和真实并发证据。
- **现状**：缺月边界、月限次真实并发、批准×撤销真实并发、双 parent/双 student，以及完整 Route 角色/跨学生错误矩阵。
- **整改**：补充下列可定位测试：
  1. `Asia/Shanghai` 月末/月初 request month 边界；
  2. 月限次下并发申请/批准的唯一结果；
  3. 批准×撤销真实并发；
  4. 双 parent、双 student、结束一个关系后其余访问/目录不变；
  5. catalog create/update/list 与 redemption create/cancel/approve/reject 的 student、创建家长、其他有效家长、解除家长、跨学生、缺 header、非法 DTO、unknown ID Route 矩阵；
  6. F01/F04 的原子回滚和 payload 冲突。
- **验证**：实施记录逐项映射测试名称，不得以“测试全绿”代替矩阵。

## 3. 非阻断技术债（本轮不要求专门整改）

- `countMonthlyUsage` 不必为 async；student/parent sanitize 目前是 identity wrapper。
- `0025` 与 `0024` 的 ledger constraint 调整存在重复迁移观感。迁移已提交且可能被本地应用，除非 R01～R06 必须，不要求删除或改写历史迁移。

不得把这些非阻断项升级为额外范围；顺手修改仅限不扩大风险且不增加依赖。

## 4. 允许范围与验证

只修改 R01～R06 所需的 Redemption service/Route、关系结束调用 seam、对应 migration/schema（仅必要时）、测试和 `p1-implementation-record.md`。禁止 P2/P3、UI、导出/删除/tombstone、依赖升级和无关重构。

无其他 runner 时串行执行：

```bash
pnpm db:migrate
pnpm test tests/integration/redemption/redemption-lifecycle.test.ts tests/integration/api/m6-routes.test.ts tests/integration/migrations/m6-schema-constraints.test.ts tests/integration/family-access/multi-parent-authorization.test.ts tests/integration/settlement/settlement-ledger.test.ts tests/integration/outbox/outbox-transaction.test.ts tests/integration/audit/audit-coverage.test.ts
pnpm typecheck
pnpm lint
pnpm format
```

随后补跑 `pnpm test` 作为全量回归；若受环境或时长阻断，必须如实记录，不能写成通过。不得并行运行共享数据库测试。

## 5. 提交与回报

整改只提交一个聚焦 commit，不拆分额外实现提交。回报：

```text
branch: <分支>
HEAD: <完整 SHA>
remediation_base: 5544b9979c7e4168dacfdf2bd5a67543561ea6f5
resolved: P1-F01 ... P1-F06
changed_files:
- <文件>
transaction_and_module_boundary:
- <事务、outbox、跨模块 seam>
idempotency_and_lock_order:
- <payload hash 与精确锁序>
acceptance_matrix:
- <测试名称映射>
verification_raw_summary:
- <命令与原始摘要>
blockers:
- <无则 none>
```

最后一句必须是：**“M6 P1 集中整改已交 Codex 复验，未启动 P2，未归并、未推送、未部署。”**
