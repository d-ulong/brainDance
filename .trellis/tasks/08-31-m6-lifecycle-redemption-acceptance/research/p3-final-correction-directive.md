# M6 P3 最终窄整改指令（NO-GO）

## 固定信息

- Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
- 分支：`feat/m6-lifecycle-redemption-acceptance`
- 被审整改提交：`e5415d83899fbda4d7b1ef97672b78ffa5add0f6`
- 执行基线：以包含本文件的 Codex 提交完整 SHA 为准
- 结论：**NO-GO**。P3-C01～C04 已闭合，不得重开；仅处理下列 F01～F05。

## P3-F01：消除 READY 与 token 交付的崩溃窗口

当前 Worker 先提交 job `READY` 和 token hash，再写明文 token delivery artifact。提交后、artifact 写入前崩溃会留下永久 `READY`、无可用 token 的 job；幂等重放无法恢复。

整改要求：

- 设计可重试收敛的 ready/token 交付协议，任一提交后崩溃点都不能留下无法下载且无法恢复的 `READY` job。
- 服务端数据库、artifact 或其他持久介质不得保存明文下载 token；仍只保存 hash。可采用授权后的独立 token 签发/轮换命令，使失败响应可安全重试，但不得把 Worker 处理能力交给浏览器。
- token 必须一次性、24 小时过期、二次授权；并发签发/下载保持安全。
- 增加提交后崩溃注入、重放收敛、无明文持久化、并发签发/消费测试。

## P3-F02：恢复冻结账户的通用会话 fail-closed

当前登录与 session validation 允许冻结学生获得通用会话，且存在仅校验 session、未接 freeze guard 的普通读取入口，重写了已签署 P2 冻结契约。

整改要求：

- 恢复冻结学生普通登录/通用 session 的 fail-closed 行为。
- 删除撤销/确认若需重新认证，使用仅限这些动作的窄 capability 或等价安全流程；不能获得可调用其他 Route 的普通会话。
- 测试冻结账户不能登录或访问普通 authenticated read/write，同时仍能按产品流程安全撤销/确认删除。
- 不修改 P2 冻结矩阵的既有验收线。

## P3-F03：终态冲突 E2E 必须真正触发并断言

当前测试以按钮仍可见为条件；按钮消失时直接通过，没有产生冲突。

整改要求：通过 UI 稳定制造终态竞争/陈旧操作并断言明确冲突反馈。不得使用条件分支跳过核心断言；API 只能准备前置状态。

## P3-F04：补齐家长导出 UI 双视口验收

在 desktop Chromium 与 360×800 中，通过家长页面完成授权学生的导出创建、状态轮询、token 获取/下载及失败反馈，并覆盖无权学生不泄露。UI 行为不能由 API helper 替代。

## P3-F05：修正 RTO 计时语义

`totalRtoMs` 必须从恢复/restore 启动点开始，覆盖 restore → tombstone/撤权重放 → 投影重建 → canary；不得包含夹具准备或备份创建。输出各阶段与总 RTO，并同步修正实施记录。

## 验证、工作区与回报

至少执行聚焦测试、`pnpm db:migrate`、`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm build`、`pnpm test:e2e`，以及容量 100 和恢复演练；失败/未执行必须如实记录。

当前工作区存在旧归档目录下的未跟踪 E2E 日志，它们不属于本整改：不得删除、修改、暂存或提交。Codex 与 Cursor 使用同一目录，不要 pull/fetch、切分支或创建 worktree。

完成后只做一次聚焦最终整改提交，不修改任务状态/签署，不自行 GO。回报完整 HEAD、完整执行基线、F01～F05 证据、修改文件、验证原始摘要、剩余 blocker/deferred，结尾写“已交审核”。
