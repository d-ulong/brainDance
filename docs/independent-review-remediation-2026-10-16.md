# 独立审核整改交付记录

日期：2026-10-16。基线：`main / 3d4c47637fb48b3f985674050342c0b73d30741c`。原审核见 [独立审核报告](independent-review-2026-10-16.md)。用户授权 Codex 直接完成整改；本记录描述当前未提交工作区，不等同于生产发布签署。

## 已落实的业务规则

- 已完成任务的全部执行内容通过新事实版本更正，原完成快照、积分规则和流水保留。学生按计划日当日窗口，家长保留计划日后 60 天窗口；更正要求原因、旧版本和命令幂等键。
- 普通完成、补录与到期处理统一为计划日次日 `Asia/Shanghai 22:00`，到达边界即关闭普通完成；更正独立检查窗口。
- 新个人计划实例计分并可兑换。历史冻结为零分的实例不追补。家长拥有独立余额和本人奖励，确认后立即扣分；学生兑换仍需授权家长审批。
- 练习训练仅本人可见，家庭摘要、详情和导出均排除。

## 问题与验收证据

以下路径均相对仓库根目录。测试名和关键断言可以在对应文件定位。

| 原问题              | 完成的调整                                                                                                                                 | 核心证据                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| A1 登录限速         | 每次失败独立计数；同账号串行；仅显式可信代理提供 IP 限速来源                                                                               | `tests/integration/identity/review-remediation.test.ts` 同键五次失败、并发阈值；`tests/unit/identity/security-controls.test.ts`      |
| A2 管理员及外部服务 | 密码后 TOTP 挑战，无二次验证不建会话；已接受时间步不可重用；验证码交付和扫描 HTTPS relay 有限超时、禁止跳转；生产拒绝测试绕过              | identity review 的无会话挑战/重放/验证码尝试上限；security-controls；配置契约见下文                                                  |
| A3 冻结与实时授权   | 共用主体资格策略，事务内主体锁先于资源锁；事实、目标、计划、扣分、训练和家庭内容等写入复核冻结/年龄/关系，重放也复核；解除关系遵守同一锁序 | `tests/integration/facts/facts-flow.test.ts` 冻结/19岁/伪造管理员/关系解除阻塞；identity review；family-access 现有矩阵              |
| A4 余额竞态         | 实时记账与重建先取同一主体锁再读流水，安全整数约束；反向流水精确支持原负金额                                                               | lifecycle review 的真实 PostgreSQL 等待链与最终余额断言、int32 最小值反转；settlement-ledger                                         |
| A5 无请求到期执行   | Worker 每轮有界扫描，持久化日程、删除、成年归档事件；沿用租约、幂等、重试与 dead/replay                                                    | `tests/integration/data-lifecycle/review-remediation.test.ts` 无用户命令到期、重复投递、独立年龄事件；`scripts/lifecycle-worker.mts` |
| A6 删除导出         | 普通删除同时检查确认及30天撤销期；目标/计划/清单/命令快照正文纳入最小化；身份认证数据清除；外部清理失败保留意图；导出白名单 DTO            | lifecycle review 的29/30天、目标与完整作业导出、练习排除、恢复身份后 tombstone 重放；原 deletion/export/p2 用例                      |
| A7 事件消费         | 集中注册事件类型和版本；需要副作用的事件有消费者，明确无副作用的才登记 no-op                                                               | `src/modules/outbox/event-registry.ts`；`tests/unit/outbox/event-coverage.test.ts`                                                   |
| A8 模块与门禁       | 目标和计划积分通过 settlement 接口；CI使用受保护的测试库名；纯单测配置不加载迁移/清库 setup；规格同步                                      | `point-rule.service.ts`、`ledger.service.ts`；`.github/workflows/ci.yml`；`vitest.unit.config.ts`；新增 backend 契约                 |
| F1 完成与更正       | 完整完成快照；更正新增事实、反向结算和重新结算同事务；旧 formal 计划沿用前驱历史规则，缺失或歧义整笔回滚                                   | `tests/integration/schedule/review-remediation.test.ts` 连续更正/负奖励/A10切B20仍按A10/缺失历史结算回滚                             |
| F2 元数据丢失       | 清单 DTO 和输入校验保留标题、完成、时长及扩展执行字段；revision防止覆盖更新                                                                | schedule review 的字段往返、双端并发冲突；execution-state 单测                                                                       |
| F3 幂等与计时       | 持久命令结果，异载荷冲突；计时状态服务端收口，暂停重试无重复累计；前端可恢复                                                               | schedule review 的命令重放、timer完成/暂停；execution-timer 单测；浏览器更正提交                                                     |
| F4 截止与优先级     | 查询和写入共用截止策略；次日22点前可开始/补录；同级最高优先级共存，移除后恢复被覆盖实例                                                    | schedule review、persist-expired、plan-library 及 time-policy 单测                                                                   |
| F5 成年停写         | 生日跨档次日生效；19岁新业务停写、历史可读；后台归档未来日程                                                                               | identity/lifecycle review；time-policy 单测                                                                                          |
| F6 训练分段隐私     | 按定义/年龄分段摘要；SQL限定趋势日期并批量读取指标；本人练习不进入家长出口                                                                 | lifecycle review 的定义/年龄分段及练习；training 各核心受影响文件                                                                    |
| U1 执行入口         | 草稿编辑和已完成更正分开；截止/覆盖状态不显示无效操作；更正可改清单、实际时间、计时等执行依据                                              | schedule review；双主题浏览器夹具的更正、截止无动作和上海时间输入                                                                    |
| U2 日历             | 月末前后导航夹取合法日期；稳定定位到指定日期/任务；月摘要只统计本月，网格仍展示邻月                                                        | schedule-calendar 单测；双主题桌面/手机月摘要与深链检查                                                                              |
| U3 首页             | 学生下一步直达任务，不将跳过/过期/错误误报全部完成；家长优先待审批/评定/兑换                                                               | home-schedule 单测；`parent-home-dashboard.tsx`、`student-home-dashboard.tsx` 静态复验                                               |
| U4 网络恢复         | session失败释放缓存，强制请求不被旧结果覆盖；所有调用页面和训练入口提供错误/重试                                                           | session-cache 单测；session-recovery 浏览器14路径×2视口，27项首轮通过、1项等待请求失败后复验通过                                     |
| U5 视觉与表达       | 保留双主题，语义状态/可见焦点/更大文字及操作区，窄屏按钮换行；修正浅色主按钮前景和选中页签                                                 | 四组主题×视口截图：无横向溢出、任务操作区至少44px；所测操作文字最低对比度深色9.68、浅色5.01（不是全站对比度认证）                    |

## 实际验证

此次涉及授权、锁序、账务及多个模块，代码级检查不足以验证风险，因此扩大到显式隔离 PostgreSQL 并发验证和聚焦浏览器交互。没有运行试点库迁移、部署、全量 E2E 或本地生产构建。

- 隔离库：本次专用容器 `braindance-review-test-20261016`，仅 `127.0.0.1:55432/braindance_review_test_20261016`。每条数据库测试命令显式指定此库及 `.review-runtime` 媒体/导出目录，串行执行；没有从 `.env.local` 隐式选库。新增0048–0051迁移在此库执行成功。验证结束已停容器，未删除库。
- 数据库首轮：52文件426项中403项通过，发现23项失败；集中修复夹具、历史行为断言及真实并发测试锁等待后，18文件146项全部通过。最终事实/更正/结算补充复验3文件54项全部通过。按每文件最新通过记录汇总为52文件440项，**不是一次完整最终套件运行**。逐文件结果见 [数据库证据索引](../.trellis/tasks/10-16-independent-review-remediation/evidence/integration-results.json)。
- 最终纯单元：22文件136项通过。命令：`node node_modules/vitest/vitest.mjs run --config vitest.unit.config.ts tests/unit/client tests/unit/schedule tests/unit/time-policy tests/unit/identity/security-controls.test.ts tests/unit/data-lifecycle/body-redaction.test.ts tests/unit/outbox`。
- 最终静态：`tsc --noEmit --incremental false` 通过；受影响179个源码/测试/脚本文件 ESLint 0错误、1个原有 `_nodeEnv` 未使用警告；`git diff --check` 通过。
- 浏览器：真实 Chrome 加模拟 API 的5组 UI 流程通过（桌面/360px、双主题更正及家长本人奖励创建/确认扣分展示）；session恢复28项分两轮全部通过。模拟接口证明页面交互，真实数据库账务与权限由上述集成测试证明。证据截图及 [浏览器结果](../.trellis/tasks/10-16-independent-review-remediation/evidence/browser-results.json) 存在任务 evidence 目录。
- 最终独立代码复验：首次发现的 facts 授权/锁序和 legacy 更正规则阻断已修复并通过最终复验；家长本人 balance/ledger 路由4项单元通过。当前代码审核无剩余阻断。

原始本机命令日志保留在任务 `evidence/*.log`，不提交大体积运行日志。浏览器使用3004端口及临时 `.review-next` 目录，避免覆盖原有 `.next` junction；服务停止后已恢复 `next.config.ts`、`tsconfig.json`、`next-env.d.ts`，这些临时设置不纳入交付。

## 配置与上线边界

生产管理员 TOTP 安全登记、验证码和扫描 relay 的真实账号/密钥由部署方提供。代码已具备适配接口和缺少配置时明确拒绝的保护；未冒用生产凭据或声称真实服务已联调。具体协议、环境变量和测试环境隔离要求见 [身份与媒体配置](identity-security-configuration.md)。

迁移采用 expand：0048执行版本/命令，0049身份保证，0050有符号反向流水，0051安全整数容量。上线前应先核查既有数据符合新约束，再迁移、配置真实服务、部署 web 与 Worker 并执行发布验证。未改写已应用迁移和历史事实。回退代码不能撤销已经产生的更正/兑换流水；需要保留新增表列及不可变记录，不执行破坏性 down migration。

现有 `src/lib/lucia.ts` 仍依赖 Lucia3/Drizzle adapter 提供会话和 cookie；业务授权、会话授权纪元及二次验证由本项目服务维护。本次已补齐管理员保证和更新会话的保证传递，没有在安全整改中替换整套认证依赖。后续替换范围应限定会话适配与 cookie 契约，保留现有 session id/撤销/授权纪元/二次验证兼容，并以登录、退出、到期、关系解除和MFA矩阵作为迁移验收。依赖弃用是维护事项，未把这次修复表述为完成依赖迁移。

当前尚未执行生产备份恢复、容量压测、真实外部服务联调或线上监控验收；本记录只签署有定位证据的实现和本机验证。

## 提交边界

本次代码、回归测试、迁移、规格和记录作为一次聚焦整改提交，提交计划见任务目录的 `commit-plan.md`。原有 `tests/setup.ts`、`vitest.config.ts`、本地 Docker/IDE/Claude 文件不纳入；`playwright.config.ts` 仅纳入本次认证夹具和独立开发测试服务的增量，原有测试产物路径改动保留。当前未提交、未推送、未归档任务，等待工作流要求的一次提交确认。
