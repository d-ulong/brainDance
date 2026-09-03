# M7 P2 封板修正唯一指令

## 决策覆盖

- 用户已撤销 P2 范围回退决定；`p2-scope-rollback-directive.md` 不得执行，仅保留为历史记录。
- 保留提交 `4b0421c0b925f4a6253f5bf86a3f99edbc1a0975` 的 P2 架构返工成果。
- 本阶段只关闭终审中三个已定位缺口，不重构架构、不删除 P2、不增加新验收项。
- 本次之后直接进行里程碑门禁，不再产生业务整改轮次。

## SC-01 migration gate 必须先于任何 mutation

- `scripts/migrate.ts` 必须先调用 `assertMediaMigrationCompatibility(sql)`，通过后才允许调用 Drizzle `migrate()`；错误路径也必须可靠关闭连接。
- 可在 migrate 后再次校验，但不能用后置校验替代前置 gate。
- 聚焦测试必须调用与生产入口相同的编排或可测试的同一函数，准备“已记录旧 0030 checksum”的数据库，断言 gate 抛错且 0031 的列、约束和 migration ledger 记录均未出现。
- 不 drop/reset 用户数据库，不改写或重编号 migration。

## SC-02 同 payload 并发上传必须确定收敛

- 使用独立连接/事务与受控 barrier 同时提交相同 actor、idempotency key 和 payload。
- 目标语义：两个调用最终都返回同一个 ready media（一个 created、一个 idempotent replay，或仓库明确规定的等价确定结果）；不得接受 `MEDIA_UNAVAILABLE`、`MEDIA_REJECTED` 等宽泛偶发结果。
- 断言数据库只有一个 media object、一个 ready 事实、一个 `media.uploaded` audit；不得通过“至少一个成功”放宽验收。
- 若当前实现不能达到上述语义，只做实现该确定收敛所需的最小锁/等待/重读修正。

## SC-03 purge 四类故障必须逐项独立证明

分别建立四个独立场景，不串用同一个对象或 generation：

1. `purgeSafe` throw-before-delete；
2. `purgeSafe` delete-before-throw；
3. safe 成功、staging 删除失败；
4. 两个物理对象删除成功、DB finalize 失败。

每个场景都必须断言：

- 故障后保持 `purging + prepared + owned_generation`；
- 中间态 attach 失败，既有/新 capability 均不可读；
- 相同 generation 重试后为 `purged + completed`；
- safe/staging 对象均不存在；
- active reference=0、live capability=0；
- `media.purged` audit 恰好一条；
- 重复 replay 不增加 audit 或恢复可读性。

## 证据真实性与交付

- 修正 `p2-architecture-rework-record.md` 中对旧测试的夸大描述，并新增 SC-01～SC-03 精确证据。
- 只运行受影响的 media integration、migration gate 聚焦测试及 `git diff --check`；不要运行全量 test/build/lint/typecheck，也不重复此前已经通过且未受影响的 E2E。
- 只创建一个聚焦封板提交；不 push、merge、部署或操作用户数据库。
- 回报完整基线/HEAD、SC-01～SC-03 文件与测试证据、命令结果、未运行项和工作区状态，结尾写“已交 P2 封板审核”。

