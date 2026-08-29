# M3 账本与后台可靠性

## Goal

交付可审计的人工质量事实确认与更正、可靠 outbox Worker 和余额投影重建：更正已确认错误数时永不改写历史，原积分准确冲销、新结算恰好一次；异步重复、失败和人工重放均不制造重复账本。

## Confirmed facts and decisions

- **M3-D01 权限：**已验证且与目标学生保持 active relationship 的家长可发起已确认人工事实的更正；管理员可审计全部记录并基于安全或数据纠错原因兜底；学生不能确认或更正。
- **M3-D02 交付面：**本期只交付受控 API/后台路径；不新增家长可操作的 Web UI。授权始终在服务端实时核验。
- **M3-D03 死信告警：**达到重试上限的事件写入 dead 状态、受控管理员查询接口和人工重放审计，并在 Worker 入口输出经脱敏的结构化错误日志；本期不接邮件、钉钉或其他第三方通知服务。
- 产品文档已定义错误数等人工质量事实须经任一关联家长确认后方可结算；更正窗口是计划日后 7 个家庭自然日，超期只允许管理员安全或数据纠错处理。
- M2 已有系统完成事实、同步结算、不可变流水、余额投影和事务 outbox；`outbox_events` 还没有租约、尝试次数或 Worker，`fact_versions.schedule_item_id` 仍是 M2 范围下的非空列。

## In scope

1. 为正式日程引入版本化人工质量事实（首期为 `error_count`）的提交、家长确认和已确认事实更正；原事实、确认、结算和流水均只追加。
2. 为更正链建立可追溯关系：新事实版本、旧版本作废语义、冲销结算/反向流水、新规则结算，以及每步 audit/outbox。
3. 扩展规则版本和结算接口，使结算可消费经确认的错误数，并将实际规则版本快照保留在既有结算记录中；规则编辑不重算既有历史。
4. 实现 PostgreSQL outbox 的领取、有限租约、指数退避、最大尝试、dead、管理员查询、人工重放和尝试审计。Worker 只处理已提交的事件，重复领取或租约到期不得重复账本副作用。
5. 提供受控 CLI，从权威 `point_ledger_entries` 重建 `point_balance_projection`；重建不产生业务 outbox、结算或额外流水。
6. 提供 M3 API 的授权、幂等、冲突、审计和运维测试证据。

## Out of scope

- 家长确认/更正 Web UI、站内通知和第三方告警通知。
- 兑换、手动奖励、导出、删除、多家长专门 UI、Stroop/数字广度、18:00 自动扣分和日程滚动消费者。
- 改写 M1/M2 历史事实、结算、流水或规则版本；M3 只通过新增版本和反向流水修正。

## Requirements

- **M3-R01 Fact command boundary.** 仅正式日程可写人工 `error_count` 事实；值为非负整数，记录声称、记录、确认、操作者、原因与幂等键。学生可提交待确认事实；仅已验证关联家长可确认。
- **M3-R02 Correction authorization and time.** 关联家长只能更正自己当前可访问学生的已确认人工事实且在窗口内；管理员可超期兜底但必须给出安全或数据纠错原因。其它角色、失效关系、系统事实、未确认事实和错误目标稳定拒绝。
- **M3-R03 Immutable correction and settlement.** 更正新建版本并关联被取代版本；旧结算不更新，旧流水以 `reverses_entry_id` 指向的负数流水冲销；新事实依规则版本产生唯一结算/流水。相同命令重放和并发竞争均返回既有结果且不得重复。
- **M3-R04 Outbox delivery.** 每个会触发后续处理的命令在同一事务写权威事实、audit 和 outbox。Worker 以原子领取/租约处理；成功标记 processed，失败按退避回 pending，耗尽后 dead；每次尝试有可查询的审计记录。
- **M3-R05 Operations.** 管理员可列出 dead 事件并重放；重放创建新尝试、保留旧失败历史，且不允许绕过事件幂等。CLI 可按全部或单学生从 ledger 重建余额投影。
- **M3-R06 API contract.** 新写 API 必须要求 `Idempotency-Key`，使用 M2 嵌套错误体，输入使用 Zod，路由保持薄并委托 Module service。

## Acceptance criteria

| ID | Observable outcome | Required evidence |
| --- | --- | --- |
| AC-M3-1 | 关联家长确认错误数后，规则按该确认版本结算；无确认不结算。 | integration：服务、规则、数据库约束 |
| AC-M3-2 | 更正已确认错误数后，旧事实/结算/流水仍存在；恰有一条指向旧流水的反向流水和一条新结算。 | integration：更正链与余额断言 |
| AC-M3-3 | 更正的同键重放和并发请求不产生重复事实、结算、ledger、audit 或 outbox。 | integration：冲突/并发用例 |
| AC-M3-4 | 未验证家长、失效关系家长、学生和越权管理员路径均被拒绝；管理员超期更正有原因和审计。 | API integration：401/403/409 与 audit |
| AC-M3-5 | Worker 重试、租约失效和人工重放均不重复 ledger；耗尽事件为 dead、可由管理员看到，并生成脱敏结构化错误日志。 | worker integration + CLI/route tests |
| AC-M3-6 | 从 ledger 重建后，每位目标学生的余额和最后流水标识与权威账本一致；重建无新增 ledger/outbox/audit。 | CLI integration |
| AC-M3-7 | 迁移、目标测试、类型、lint、format、build 通过；共享数据库集成测试串行运行。 | 原始命令摘要与固定 SHA |

## Risks and mitigations

- 账本冲销与新结算并发：数据库唯一约束、行锁、同一事务和竞争回读。
- Worker 至少一次交付：消费者幂等键、租约令牌和处理记录；重建不经 Worker 副作用。
- 结构化日志泄露：只记录 event ID/type、attempt、错误类别与关联 ID，禁止 payload、事实值、账号或令牌。
- M2 schema 收窄：采用 expand migration 解除人工事实需要的 `schedule_item_id` 非空约束，但保留系统事实约束及回归测试。

## Planning status

阻塞问题已清零。本 PRD 已完成收敛；实施仍需用户对最终规划摘要作出一次新的明确批准，随后才可启动任务和下发 Cursor 第一阶段。
