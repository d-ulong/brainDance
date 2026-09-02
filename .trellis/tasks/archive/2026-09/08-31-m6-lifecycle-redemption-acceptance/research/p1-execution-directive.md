# M6 P1 兑换目录、申请与唯一扣减 Cursor 执行指令

> Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
>
> 目标分支：`feat/m6-lifecycle-redemption-acceptance`
>
> 完整执行基线：`1d6ab103e2baba20ecec811c3b409ca671cbcf6c`
>
> 阶段状态：M6 已激活；**只授权 P1，不授权 P2/P3、归并、推送或部署。**

## 1. 开始前核验

Codex 与 Cursor 使用同一目录，不执行 pull、fetch、切换分支或创建 worktree。先运行并记录：

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
git merge-base --is-ancestor 1d6ab103e2baba20ecec811c3b409ca671cbcf6c HEAD
```

必须位于 `feat/m6-lifecycle-redemption-acceptance`，工作区干净，HEAD 包含完整执行基线。任一条件不满足立即停止；不得自行 reset、rebase、stash、checkout 或清理文件。

## 2. 唯一事实源与范围

先完整阅读：

- `.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance/prd.md`
- `.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance/design.md`
- `.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance/implement.md` 的 P1
- 本指令
- `implement.jsonl` 中登记的相关规范与设计文档

只实施 R-M6-01、R-M6-02 与 AC-M6-01、AC-M6-02：兑换目录、申请/撤销、批准/带理由拒绝、价格快照、月限次、唯一扣减流水、权限、幂等、并发、审计/outbox 和薄 Route。不实现产品 UI。

## 3. 必须交付

### P1-R01 数据模型与约束

- 新增 `redemption_catalog_items`、`point_redemptions` 的 Drizzle schema、SQL migration、barrel export 与约束测试。
- 目录成本必须为正整数；月限次为 null（不限）或正整数；状态值由数据库 check 约束。
- 申请保存 `cost_snapshot`、申请月份所需稳定业务字段、创建/终态操作者与时间、创建命令幂等键/payload hash。
- approved 申请至多关联一条负向 ledger entry；数据库约束必须阻止重复扣减和非法状态/字段组合。
- 不修改既有 ledger entry，不物理删除目录或申请历史。

### P1-R02 目录所有权与离关联处置

- 当前 active relationship 家长可为关联学生创建目录项；只有 `creator_parent_id` 可编辑、启停。
- 其他有效家长可读但不可修改；学生只读 active 项并可申请。
- 目录更新只影响新申请；旧申请始终使用 `cost_snapshot`。
- 扩展现有 creator config deactivation：创建家长关系结束后，其 active 目录项停用，相关 pending 申请无扣分地取消；其他家长目录与历史终态不受影响。
- 重新关联不得自动恢复目录项或申请。

### P1-R03 申请状态机

- 学生仅可针对自己的 active 目录项创建 `pending`；达到目录单项自然月限次时拒绝。
- 学生只可撤销自己的 pending 申请；当前关联家长可批准，拒绝必须填写非空简短原因且对学生和有效家长可读。
- `pending → approved|rejected|cancelled` 为唯一终态转换；所有终态重复/竞争必须确定性返回重放或冲突，不得最后写覆盖。
- 所有写命令要求 `Idempotency-Key`；相同 key+payload 重放原结果，不同 payload 返回冲突。

### P1-R04 唯一扣减、余额与并发

- 批准事务按文档化稳定顺序锁定申请、学生余额及月限次相关记录。
- 同事务重新验证 pending、active relationship、足额且非负余额、月限次，然后写 approved、唯一负向 ledger entry、余额投影、audit 与 outbox。
- 余额不足或余额为负拒绝，不产生状态变更、流水、audit/outbox 副作用。
- 并发批准/拒绝/撤销及重复批准最多一个终态；批准最多一条扣减流水，余额只减一次。
- 不得直接复用 settlement 的正向结算语义伪装兑换；ledger `source_type/source_id/reason` 必须可解释并指向申请。

### P1-R05 Route、错误和证据

- Route 只做 session、输入解析、idempotency header 与 service/DTO 映射；SQL 与锁逻辑留在 `src/modules/redemption/`。
- 学生、创建家长、其他有效家长、已解除家长和跨学生账号形成完整 2xx/4xx/403 矩阵；无权与不存在不得泄露资源存在性。
- audit/outbox 不含拒绝理由以外的敏感正文，不记录 session cookie 或任意令牌；事件 payload 版本化、最小化、可去重。
- 写 `.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance/research/p1-implementation-record.md`，逐项映射 P1-R01～05、R/AC、文件、测试与原始命令摘要。

## 4. 测试与验证

先写失败测试，再实现。至少覆盖：

- migration check/unique/FK 与非法状态组合；
- 价格修改后的旧申请快照；不限/限次、月边界、达到限次；
- 余额恰好、余额不足、负余额；
- 同 key 重放、不同 payload 冲突；
- 批准×批准、批准×拒绝、批准×撤销真实并发；
- 双 parent、双 student、解除一个关系后其他关系不受影响；
- ledger、balance、audit、outbox 的事务原子性与唯一性；
- Route cookie 身份、header、DTO 脱敏和错误矩阵；
- M1–M5 相关回归不得退化。

在无其他共享测试 runner 时串行执行：

```bash
pnpm db:migrate
pnpm test tests/integration/migrations tests/integration/settlement tests/integration/redemption tests/integration/api tests/integration/family-access tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
```

如果 Vitest 路径不存在或过滤结果不覆盖新增测试，应使用实际新增文件的精确路径补跑并如实记录。不得把未执行项写成通过。

## 5. 禁止范围

- 禁止 P2 导出、删除、冻结、tombstone、artifact store 或账户清除。
- 禁止 P3 UI、E2E、容量与恢复演练。
- 禁止对象存储供应商 SDK、第三方依赖升级、M7/M8、无关重构或修改冻结的 PRD/design/implement/本指令。
- 禁止 merge、rebase、reset、push、deploy、创建分支或切换 worktree。
- 只允许一个 P1 业务实现提交；不要为格式、测试或记录拆分额外提交。

## 6. 提交与固定回报

全部验证结束后提交一个聚焦 commit。回报必须严格包含：

```text
branch: <分支>
HEAD: <完整 SHA>
execution_base: 1d6ab103e2baba20ecec811c3b409ca671cbcf6c
resolved:
- P1-R01 ... P1-R05
- R-M6-01, R-M6-02
- AC-M6-01, AC-M6-02

changed_files:
- <文件>

schema_and_invariants:
- <表、约束、状态机、锁顺序>

authorization_and_concurrency:
- <权限矩阵与真实并发结果>

verification_raw_summary:
- <实际命令>: <原始摘要>

blockers:
- <无则写 none>
```

最后一句必须是：**“M6 P1 已交 Codex 审核，未启动 P2，未归并、未推送、未部署。”**
