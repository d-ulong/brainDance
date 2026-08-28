# M1 身份与单家庭训练闭环

## Goal

交付首个可演示、可测试的纵向切片：管理员邀请码封闭注册 → 已验证家长与一名学生建立双向确认的家庭关联 → 学生完成一次反应力训练 → 双方在刷新或重新登录后仍能读取授权范围内的结果。本里程碑不包含计划、积分、多家长、其他训练项目或完整运维能力。

## Background

- 权威术语：`CONTEXT.md`；持久化模型：`docs/data-model.md`；Module 边界：`docs/architecture.md`。
- 路线图 M1 验收（`docs/implementation-roadmap.md`）：未接受不得访问；关联码不可复用；训练结果可重读。
- 仓库当前仅有设计文档，无应用代码；本任务只产出 Trellis 规划工件，不写业务代码、不安装依赖、不修改 `docs/` 下既有设计文档。

## In Scope

### 账号与邀请（Identity · 最小子集）

- 管理员通过受控引导创建首位超级管理员（生产）或开发种子（本地）；管理员可创建、撤销带角色/有效期/次数限制的邀请码。
- 家长凭邀请码注册，填写显示名与联系方式（手机或邮箱），完成验证码验证后账号激活。
- 学生开户二选一（M1 均需验收至少一种路径，推荐默认演示路径见 Notes）：
  - **路径 A（受控）**：已验证家长为 5–12 岁学生创建账号（用户名、出生日期、初始密码）。
  - **路径 B（自主）**：13–18 岁学生凭管理员发放的学生邀请码自行注册。
- 学生使用用户名 + 密码登录；家长使用已验证联系方式 + 密码登录。
- 5–12 岁学生首次登录必须修改初始密码。
- 登录失败锁定（5 次 / 15 分钟）与安全审计事件（锁定、解锁、登录成功/失败）写入 `audit_events` 或等价最小表。
- 会话携带 `authorization_epoch`；改密或撤权后会话失效（M1 至少覆盖关联解除与家长验证激活）。

### 家庭关联（Family Access · 单家庭）

- 学生登录后生成短时一次性学生关联码（10 分钟、同一学生至多一个有效码、可主动失效）；家长凭码发起关联申请，系统不提供学生搜索。
- 学生必须在本人账号中接受或拒绝；接受前双方互不可见对方业务数据。
- 接受时在单事务内创建 `active` relationship、必要时创建 family（`Asia/Shanghai`）、写入 `family_memberships` 投影、递增双方 `authorization_epoch`、写审计与 outbox 占位（M1 可同步处理 outbox，不启动独立 Worker）。
- 关联码消费后不可复用；过期/拒绝/72 小时 pending 过期均不授予访问权。
- 首位家长与学生生效关联时留存监护同意与隐私政策版本（`guardian_consents`）。
- 单方解除关联：立即撤销对方访问、递增授权纪元、写审计。

### 训练（Training · 反应力 only）

- 种子一条反应力 `training_definitions`（含版本、年龄档 5–8 / 9–12 / 13–18 至少支持当前学生档）。
- 学生会话流：`created → active → submitted → validated → completed`；服务端根据 `training_events` 计算中位反应时与准确率（异常值剔除规则按 `CONTEXT.md`）。
- 每日首条 `session_kind=effective` 计入档案投影；同日后续为 `practice`（M1 可只展示，不接积分）。
- 失焦暂停；累计失焦 >30s 或恢复失败 → `abandoned`，不计有效训练。
- 训练结果归属学生；家长在生效关联后可读训练汇总（M1 可等同会话指标摘要），不可修改原始记录。
- 客户端上报不可直接信任最终指标；持久化后刷新页面、重新登录仍可读取。

### 审计（最小）

- 必须审计：邀请码创建/撤销/消费、关联码生成/消费/失效、关联申请接受/拒绝/解除、监护同意留存、训练会话完成/放弃、登录锁定相关安全事件。
- 审计 metadata 类型化、脱敏；不得写入密码、邀请码/关联码明文、训练答案正文。

### 界面（最小可用）

- 移动优先 Web；角色首页占位即可，但必须能走通注册、验证、关联、训练、结果查看全链路。
- 训练输入支持触控/鼠标与 `Space`/`Enter`。

## Out of Scope（明确延后）

| 能力 | 目标里程碑 |
| --- | --- |
| 正式计划、日程、积分、兑换 | M2+ |
| Stroop、数字广度、完整趋势 UI | M5 |
| 多家长、多学生家庭、私密总结 | M4+ |
| 独立 Worker、死信、投影重建 CLI | M3（M1 仅预留 outbox 表与同步 no-op 或内联处理器） |
| 管理员 TOTP 完整 UI、紧急访问、导出/删除 | M3/M6 |
| 站内通知中心、邮件/短信业务推送 | M2+ |
| 对象存储、CDN、生产云厂商绑定 | 实现 ADR / M6 前 |
| 第三方行为分析 | 不做 |

## Assumptions

- M1 默认演示路径：**路径 A**（家长邀请注册 → 创建 5–12 学生 → 双向关联 → 反应力）；路径 B 作为同等优先级验收用例，可在 implement 阶段第二条 E2E 覆盖。
- 验证码在开发环境可用固定 stub（如日志输出），生产接真实 SMS/邮件 Provider 的具体厂商留 ADR-0003 批准后配置。
- M1 不引入 Redis；会话与限流基于 PostgreSQL。
- 首位超级管理员本地用 seed 脚本；生产沿用 `product-scope.md` 受控初始化，TOTP 完整流程可与 M3 合并，但须在 design 中标注临时风险与补齐计划。

## Acceptance Criteria

### 必须（路线图 M1 三项 + 闭环）

- [x] **AC-1 未确认关联不可访问**：`tests/integration/family-access/family-access.test.ts`（profile + training-summary）
- [x] **AC-2 关联码不可复用**：同上 + 消费/过期/撤销用例
- [x] **AC-3 训练结果刷新后可读取**：`tests/integration/training/training.test.ts` + `tests/e2e/training-flow.spec.ts`
- [x] **AC-4 邀请码约束**：`tests/integration/identity/identity.test.ts`
- [x] **AC-5 家长验证门禁**：`tests/integration/family-access/family-access.test.ts`
- [x] **AC-6 授权纪元**：accept 后 `validateSession` 返回 null；`login.service.ts` epoch 校验
- [x] **AC-7 审计可追溯**：`tests/integration/audit/audit-coverage.test.ts`

### 建议（不阻断 M1 归档，但 implement 计划包含）

- [ ] 路径 B 学生邀请码注册 + 关联 E2E 用例。
- [ ] 5–12 学生首次登录改密强制流。
- [ ] 关联码 10 分钟 TTL 与 72 小时 pending 过期自动化测试（可用时钟注入）。

## Non-Functional（M1 底线）

- 所有敏感读写在服务端实时校验 `relationships.status = active`（及 `authorization_epoch`）。
- 写操作携带 `idempotency_key`；关联接受、邀请消费、训练提交在数据库层有唯一约束兜底。
- 360px 宽度下关联与训练主路径可操作。
- 单元/集成测试覆盖授权与关联码规则；至少一条 Playwright 覆盖 AC-1–AC-3。

## Notes

- 本 PRD 不指定框架与库；技术选型见同任务 `design.md` 与 `research/adr-0003-m1-tech-stack.md` 草案，待负责人批准后写入 `docs/adr/`。
- 实现阶段开始前有两个批准门禁：（1）本 PRD/验收；（2）技术选型 ADR。
