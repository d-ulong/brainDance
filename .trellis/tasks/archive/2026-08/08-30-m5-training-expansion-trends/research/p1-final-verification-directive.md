# M5 P1 最终复验 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定候选实现 SHA：`6f39d5f5eb68fead9a395e4cbc18682357f984aa`
>
> 阶段：**只读最终复验；取代第八轮 R35～R38，不再实施测试 helper 递归整改。**

## 1. 验收线

只按已冻结 P1 产品范围验收：R-M5-01～04、R-M5-08，AC-M5-01～04，以及生产级工程硬约束。第八轮 R35～R38 降级为非阻断测试技术债，不要求修改。

## 2. 执行动作

1. 确认分支正确、工作区干净且包含候选实现 SHA。
2. 不修改任何文件，不创建 commit。
3. 在无其他测试进程时串行执行：

```bash
pnpm db:migrate
pnpm test tests/unit/training
pnpm test tests/integration/migrations
pnpm test tests/integration/training
pnpm test tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
git diff --check 9f0418814515d2165ebba90b1e98da274ec4eacd..6f39d5f5eb68fead9a395e4cbc18682357f984aa
git status --short --branch
```

## 3. 判定边界

仅报告以下 blocker：生产规格不满足、数据/权限/安全风险、migration/schema 漂移、真实并发不变量缺失、上述必需命令失败。不得将测试 helper 的嵌套故障注入或清理诊断改进列为 blocker，也不得启动 P2。

## 4. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
verified_SHA: 6f39d5f5eb68fead9a395e4cbc18682357f984aa
status: M5 P1 最终复验已交 Codex 审核（未启动 P2）

verification_raw_summary:
- <command>: <原始摘要>

production_acceptance:
- R-M5-01 / AC-M5-01: <证据>
- R-M5-02 / AC-M5-02: <证据>
- R-M5-03 / AC-M5-03: <证据>
- R-M5-04 / AC-M5-04: <证据>
- R-M5-08: <证据>

production_blockers:
- <无则写 none>

non_blocking_test_debt:
- R35～R38：已按新协作规则降级，不实施
```

最后一句必须是：**“M5 P1 最终复验已交 Codex 审核，未启动 P2。”**
