# M7 P2 架构返工唯一指令

## 目标与固定范围

本阶段不是第三轮 P2 补丁，而是独立的合入前架构返工。只重建三个深模块及其证据：

1. `MediaPurge` module：隐藏 prepare、ownership、外部删除不确定性和 finalize；调用者只知道“处理 purge event，可重试且 fail closed”。
2. `MediaUpload` module：保留现有上传 interface，移除生产可见 test hook；通过数据库/adapter 的真实失败验证事务语义。
3. `MediaMigrationGate`：明确未发布 migration 的发布边界、fresh-install 结果和已执行开发库的兼容检查，不触碰生产数据。

不得扩展产品范围、生产供应商或 P1 行为；不得 merge、push、部署、重置数据库或改写 Git 历史。

## AR-01 purge 不确定性必须 fail closed

- `purgeSafe`、`purgeStaging` 或 finalize 任一抛错都视为结果不确定；一旦 prepare 取得 ownership，任何错误都不得把 media 恢复为 `ready` 或允许 attach/capability。
- 保持 `purging + prepared + owned_generation`，由相同 generation 幂等重试外部删除并 finalize。只有在 physical purge 尚未开始前，pending intent 才能被重新引用取消。
- 删除 `releasePurgeOwnership` 的恢复可读语义，或将其限制为 prepare 前、可证明未执行外部删除的路径。
- 测试 adapter 必须覆盖 delete-before-throw、throw-before-delete、safe 成功而 staging 失败、物理成功而 finalize 失败；每种情况重试后均为 purged、单一 audit、零 active ref/capability，且中间态不可 attach/read。

## AR-02 migration 发布边界必须可执行

- 先以代码/提交证据确认 `0029～0031` 不在 `main` 或任何已发布 tag；将这一事实写入实施记录。
- 不再修改新的已发布 migration。对于本分支未发布 migration，形成一个明确的 pre-release lineage：fresh database 从 main migration 集合升级后可一次成功得到最终 schema；异常旧媒体事实 fail closed，绝不静默删除。
- 增加两类测试：`main` migration state → 本分支最终 migration state；已记录旧 `0030` 的开发库 → 启动时明确检测 checksum/compatibility 并给出“重建非生产开发库”的操作提示，不假装已重新执行修订 SQL。
- 不在本阶段自动 drop/reset/TRUNCATE 用户数据库；只使用隔离测试数据库。若必须重编号、删除或合并未发布 migration 文件，先停下交由 Codex 执行，不由 Cursor 改写历史或做破坏操作。

## AR-03 移除生产 test hook

- 删除 `setMediaUploadFinalizeFailureHookForTest`、`setFamilyContentDeletionTxFailureHookForTest` 等进程级可变 hook。
- 通过测试数据库的事务内约束/临时 trigger，或已有真实 adapter seam 注入失败；测试必须穿过与生产相同的 module interface。
- 不为测试扩大生产 interface；测试结束在 `finally` 清理临时 trigger/adapter 状态。

## AR-04 证据必须不可空跑

- 像素炸弹 fixture 创建失败必须使测试失败或使用仓库内确定性 fixture；必须断言上传/解码路径实际被调用并返回预期错误。
- 并发上传与重复 attach 使用受控 barrier 和独立事务，断言：一个权威对象/引用、准确计数、确定错误码、相同 payload 收敛、不同 payload 冲突。
- 禁止恒真断言、吞异常后通过、手工写目标终态替代业务路径。

## AR-05 验证与交付

- 只运行受影响核心媒体测试、migration upgrade/fresh-install 测试和 P2 media 双视口 E2E；不运行全量 test/build/lint/typecheck。
- `git diff --check` clean。
- 更新 `research/p2-architecture-rework-record.md`，逐项记录 AR-01～AR-04 的 interface、不变量、故障矩阵、迁移发布边界、命令结果和未运行项。
- 创建一个聚焦架构返工提交；回报完整基线、完整 HEAD、变更文件、聚焦测试、工作区状态，结尾写“已交 P2 架构返工审核”。

