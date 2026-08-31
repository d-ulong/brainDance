# M5 P2 趋势查询、投影重建与授权 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> P1 固定实现 SHA：`6f39d5f5eb68fead9a395e4cbc18682357f984aa`
>
> 执行基线：**包含本文件的 Codex 指令提交完整 HEAD SHA，以交接 prompt 为准。**
>
> 阶段：**只授权 P2；不授权 P3、归并、推送或部署。**

## 1. 必读与冻结范围

- `prd.md`：R-M5-05、R-M5-08，AC-M5-05～07；同时不得回退 R/AC-M5-01～04。
- `design.md`：§1、§3、§4、§6、§7。
- `implement.md`：仅“P2：趋势查询、投影重建与授权”及“审核与回滚点”。
- `research/p1-signoff.md`、本文件、`CONTEXT.md`，以及 `implement.jsonl` / `check.jsonl` 指向的项目规范。

## 2. 允许范围与完成定义

1. 先固定类型化趋势 DTO：显式接收 `trainingKey` 与 `7d | 30d | all`，按 `(definitionVersion, ageBand)` 返回 segment；点包含 source session、family date、session kind 和类型化指标。
2. 将指标方向与聚合集中到共享 reducer；增量更新与 rebuild 必须复用同一语义入口，移除 reaction metric-key 特判。
3. 查询只纳入 completed/effective；invalid、abandoned、cancelled、practice 不得污染正式趋势。窗口按 `Asia/Shanghai` 家庭日期计算。
4. 明确覆盖无数据、部分覆盖、定义升级及生日次日跨年龄档；跨版本/年龄档必须分段且不得连接或比较。
5. 从权威 session/event/metric 重建趋势投影，并以可定位数据库测试证明重建结果与增量结果一致。
6. 学生只读本人；家长每次读取实时核验 active relationship。解除目标关系后立即拒绝该家长，其他有效关系不受影响；不存在与无权访问保持相同外部错误语义。
7. 为 DTO、窗口边界、排除规则、rebuild 对账、学生/多家长授权矩阵及错误路径补齐测试，并写 `research/p2-implementation-record.md`，逐项映射 R/AC 与测试位置。

## 3. 禁止项

- 禁止训练交互或趋势 UI、P3/E2E、第四项训练、自适应课程、M6、依赖升级及无关重构。
- 禁止修改已签署 P1 协议语义来迁就查询；若发现 P1 生产级阻断，停止并报告 blocker。
- 禁止依赖投影、family membership 或客户端状态放行敏感读取；禁止把任意 JSON cast 到 Route/UI。
- 禁止 merge、rebase、reset、push、deploy；禁止重写任务规格、本签署或本指令。

## 4. 验证命令

确认没有其他测试 runner 后串行执行：

```bash
pnpm test tests/unit/training
pnpm test tests/integration/training
pnpm test tests/integration/projection
pnpm test tests/integration/api
pnpm test tests/integration/family-access
pnpm typecheck
pnpm lint
pnpm format
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

目录不存在时先用 `rg --files tests` 定位仓库中的等价既有测试目录；不得创建空目录或跳过对应验证，实施记录中须写明实际命令。数据库测试必须无并发串行运行。

## 5. 提交与固定回报

- 只提交一个聚焦 P2 commit；提交前工作区不得混入测试输出或 P1 helper 技术债整改。
- 固定回报：

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整 SHA>
execution_base: <完整 SHA>
status: M5 P2 已交 Codex 审核（非 GO、未启动 P3）

resolved:
- R-M5-05 / AC-M5-05: <实现与测试证据>
- R-M5-05 / AC-M5-06: <增量/rebuild 对账及排除证据>
- AC-M5-07: <学生/家长/解除关系授权矩阵证据>
- R-M5-08: <错误语义与隐私证据>

changed_files:
- <文件>

verification_raw_summary:
- <实际命令>: <原始摘要>

blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P2 已交 Codex 审核，未启动 P3。”**
