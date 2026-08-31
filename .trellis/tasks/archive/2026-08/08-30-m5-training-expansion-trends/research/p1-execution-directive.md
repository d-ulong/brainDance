# M5 P1 训练协议与数据库不变量 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 完整执行基线：`9f0418814515d2165ebba90b1e98da274ec4eacd`
>
> 阶段状态：M5 已激活；**只授权 P1，不授权 P2/P3、归并、推送或部署。**

## 1. 开始前核验

执行并记录原始摘要：

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
git merge-base --is-ancestor 9f0418814515d2165ebba90b1e98da274ec4eacd HEAD
```

必须位于 `feat/m5-training-expansion-trends`，工作区干净，且 HEAD 包含完整执行基线。任一条件不满足立即停止，不做 reset、rebase、stash 或替代操作。

## 2. 必读仓库指令

完整读取：

1. `.trellis/tasks/08-30-m5-training-expansion-trends/prd.md`：R-M5-01～04、R-M5-07～08，AC-M5-01～04、09～10，Out of Scope、D-M5-01～02。
2. `.trellis/tasks/08-30-m5-training-expansion-trends/design.md`：§1～3、§6～7。
3. `.trellis/tasks/08-30-m5-training-expansion-trends/implement.md`：`P1：训练协议与数据库不变量` 与 `审核与回滚点`。
4. `.trellis/spec/backend/index.md`、`database-guidelines.md`、`error-handling.md`、`logging-guidelines.md`、`quality-guidelines.md`。
5. `.trellis/spec/guides/cross-layer-thinking-guide.md` 与 `code-reuse-thinking-guide.md`。

规格、设计、本文件发生冲突时立即报告 blocker，不自行改写规格或扩大范围。

## 3. P1 允许范围

只完成以下事项：

### P1-A 类型化训练协议

- 先为 Stroop v1、digit-span v1 写失败的纯函数测试，再实现最小逻辑。
- 建立单一类型化协议分派入口，负责 definition schema 解码、预期试次/尝试结构、事件验证、指标计算和指标方向元数据。
- 保持 reaction v1 的既有行为、历史结果和 API 兼容；禁止在 route、session service、projection 或 UI 重复解析同一 JSON payload。
- 未知 training key、错误 definition schema、未知/缺失/乱序/重复事件、非法边界必须确定性拒绝，不得信任客户端上传的正确性或最终成绩。

### P1-B Stroop v1 固定标准会话

- 为 `5-8`、`9-12`、`13-18` 三档定义固定、版本化的试次数、颜色集合、一致/不一致配额及有效时间边界。
- 服务端从试次刺激与作答重新判定正确性。
- 计算一致/不一致各自准确率、正确试次中位反应时、有效试次数和个人干扰差值；任一必需类别没有有效中位数时不得伪造零值。
- 仅使用仓库权威文档已冻结的指标语义；需要新增未冻结数值时，选择最小、明确、按年龄档存入 definition 的参数，并在 implementation record 中逐项列明，不得写死在 UI。

### P1-C Digit Span v1 固定标准会话

- 为三个年龄档定义顺背/倒背的固定长度阶梯、每档尝试数和展示边界，不增加跨日自适应状态或“7 课循环”。
- 服务端校验模式、长度、展示序列、作答、顺序和配额，并自行判定答案。
- 分别计算顺背/倒背最长连续正确位数；保留每档尝试结果的权威事件证据。若现有 numeric metric 表不适合保存结构化摘要，只做 P1 最小权威记录与类型化查询准备，不为 P2 趋势提前扩表。

### P1-D 定义、事务和数据库不变量

- 幂等 seed 两项新训练的三个年龄档 definition；定义不可原地修改，停用不影响历史读取。
- 先验证当前 schema 是否能阻止同 training key/年龄档多个 active definition，以及同学生/training key/family date 多条 effective。只有数据库不能表达已冻结不变量时才新增最小 migration、Drizzle schema 与隔离数据库约束测试。
- session service 按训练协议分派；提交事务维持锁定、幂等重放、校验、指标、effective/practice、投影、审计和 outbox 的原子边界。
- 并发提交与重复请求不能产生重复 effective、指标、审计或 outbox。同一天三项训练必须能各自拥有一条 effective。
- 审计、日志、outbox 和错误响应不得包含答案、完整数字序列或可还原完整题目的 payload。

### P1-E 证据记录

创建 `.trellis/tasks/08-30-m5-training-expansion-trends/research/p1-implementation-record.md`，至少包含：

- 完整执行基线、最终 HEAD、修改文件；
- R-M5/AC-M5 到测试文件与测试名称的矩阵；
- 三年龄档 definition 参数及其来源/理由；
- schema 是否变更、每条约束的实际数据库证据；
- 正常、错误、边界、乱序、重复、并发、幂等和敏感 payload 检查证据；
- 每条验证命令的原始摘要、未运行项、失败项和 blocker。

## 4. 明确禁止

- 禁止实现趋势窗口、segment DTO、趋势 API、projection rebuild 扩展或学生/家长趋势 UI；这些属于 P2/P3。
- 禁止新增训练入口、Stroop/数字广度浏览器页面或 E2E；P1 只做协议、服务、定义和数据库证据。
- 禁止自适应难度、课程进度、第四项训练、排行榜、“脑年龄”、医学/智力解释、M6、AI/语音、通知或媒体。
- 禁止修改 M1–M4 已签署产品行为，禁止无关重构、依赖升级、格式化无关文件。
- 禁止 merge、rebase、reset、force push、push、删除分支、归档任务或部署。
- 禁止启动 P2；即使 P1 测试全部通过，也只能提交审核。

## 5. 验证命令

按共享数据库无并发条件串行执行并记录原始摘要：

```bash
pnpm db:migrate
pnpm test tests/unit/training
pnpm test tests/integration/migrations
pnpm test tests/integration/training
pnpm test tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
git diff --check 9f0418814515d2165ebba90b1e98da274ec4eacd..HEAD
```

若仓库测试过滤语法导致命令覆盖范围与预期不同，记录原始输出后使用最小等价命令补跑，不静默省略。不得把未运行或受环境阻塞的测试表述为通过。

## 6. 提交要求

- 只提交一个聚焦的 P1 实现 commit；提交信息建议：`feat(m5-p1): add fixed training protocols`。
- 提交必须包含 implementation record，且工作区最终干净。
- 不修改本执行指令、PRD、design、implement 或任务状态；发现规格缺陷只报告 blocker。

## 7. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 40 位 SHA>
execution_base: 9f0418814515d2165ebba90b1e98da274ec4eacd
status: M5 P1 已交 Codex 审核（非 GO、非 M5 完成）

resolved:
- <R-M5/AC-M5 ID>

changed_files:
- <path>

verification_raw_summary:
- <command>: <原始通过/失败摘要>

schema_decision:
- <是否新增 migration、约束及原因>

unresolved_or_blockers:
- <无则写 none；不得隐瞒未运行项>
```

最后一句必须是：**“M5 P1 已交 Codex 审核，未启动 P2。”**
