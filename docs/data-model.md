# 数据模型

## 1. 通用约定

- 主键使用 UUID；时间戳以 UTC 保存。`family_date`、计划本地日期/时间和业务截止时间只按家庭固定 `Asia/Shanghai` 计算。
- 每个资源明确 `subject_student_id`（数据关于谁）、`creator_id`/`owner_id`（谁可改配置）和 `family_id`（隔离归属）；不得将前端传入的属主作为授权依据。
- 领域事实、结算与审计只追加；可重建的成员、余额、首页和趋势均为投影。
- 所有命令写入携带 `idempotency_key`；数据库唯一键是最终幂等防线。

## 2. 身份、家庭与授权

| 实体 | 关键字段 | 约束与事实源 |
| --- | --- | --- |
| users | id、role、display_name、birth_date、username/email/phone、contact_verified_at、status、authorization_epoch | student 必有出生日期和用户名；parent/admin 使用已验证联系方式；授权纪元在撤权时递增 |
| families | id、timezone、created_at | timezone 固定 `Asia/Shanghai` |
| relationships | id、family_id、parent_id、student_id、status、accepted_at、ended_at、ended_by | **亲子协作与访问授权的权威事实**；同一亲子对只有一条 active；学生只能有一个 active family |
| family_memberships | family_id、user_id、member_role、joined_at、left_at、derived_from_version | 关系派生投影，不得单独授权；活跃成员当且仅当存在同家庭 active relationship |
| relationship_requests | id、initiator_id、student_id、association_code_id、status、expires_at | pending/accepted/rejected/cancelled/expired；接受时事务校验家庭归属和关联码消费 |
| student_association_codes | id、student_id、code_hash、expires_at、consumed_at、revoked_at | 10 分钟、一次性、同一学生最多一个有效码；不保存明文 |
| guardian_consents | id、student_id、parent_id、consent_type、policy_version、accepted_at、evidence | 只追加；首位家长须留存监护同意与政策版本 |
| private_access_grants | id、resource_type、resource_id、parent_id、granted_at、revoked_at | 私密资源逐家长授权；关系结束事务内撤销 |
| invitations、invitation_redemptions | code_hash、target_role、expires_at、max_uses、used_count | 邀请码消费与注册在同一事务；parent/student 默认 7 天、admin 默认 24 小时 |
| login_security_events、password_reset_events、contact_change_requests、admin_totp_credentials | 安全事件、重置、换绑、TOTP 凭据 | 安全事件只追加；管理员 TOTP 密钥仅密文保存 |

关键不变量：父母解除一条关系但仍关联同家庭其他学生时，其成员投影保持 active；最后一条家长关系结束才进入无家长状态。关系接受、成员投影更新、授权纪元递增、私密授权撤销和 outbox 写入必须在一个数据库事务内完成。

敏感读取实时查询 active `relationships` 与资源专用授权。查询投影只能用于筛选候选资源；命中资源仍需实时授权。撤权后的会话、缓存和媒体访问链接必须校验 `authorization_epoch`。

## 3. 训练

| 实体 | 关键字段 | 约束 |
| --- | --- | --- |
| training_definitions | id、training_key、version、age_band、metric_schema、active | `(training_key, version, age_band)` 唯一；版本不可变 |
| training_sessions | id、student_id、training_key、definition_id、definition_version、age_band、family_date、started_at、finished_at、status、session_kind、idempotency_key | `(student_id, training_key, family_date)` 对 `session_kind=effective` 部分唯一；其余 completed 为 practice |
| training_events | id、session_id、sequence、event_type、payload、occurred_at | `(session_id, sequence)` 唯一；原始事件只追加 |
| training_metrics | session_id、metric_key、value、unit、is_valid、calculation_version | 指标来自服务端校验，非客户端传入成绩 |
| training_profile_projection | student_id、training_key、definition_version、age_band、metric_key、best_value、last_value、window_summary、last_source_session_id | 不跨版本或年龄档聚合；可由 completed 会话重建 |

会话状态：`created → active → submitted → validated → completed`；`active/submitted → cancelled/invalid/abandoned`。累计失焦超过 30 秒或恢复失败为 abandoned。年龄档、训练版本、输入方式和家庭日期均在会话中快照。

## 4. 目标、计划、日程与事实

| 实体 | 关键字段 | 约束 |
| --- | --- | --- |
| goals | id、student_id、creator_id、title、status、start_date、due_date、closed_at | 仅 creator 可完成/关闭 |
| plans | id、student_id、owner_id、goal_id、plan_kind、source_plan_id、status、current_version | personal 归学生；formal 归家长；formal 只归一名学生 |
| plan_versions | id、plan_id、version、schedule_rule、effective_from、effective_until、created_at | 只追加；变更从次日起生效 |
| plan_schedule_slots | id、plan_version_id、slot_key、local_time | `(plan_version_id, slot_key)` 唯一；支持同日多时间点 |
| schedule_items | id、plan_id、plan_version_id、student_id、owner_id、family_date、slot_key、scheduled_at、status、source、occurrence_key、plan_snapshot | `occurrence_key=(plan_id, plan_version, family_date, slot_key)` 唯一；手动日程使用自身稳定键 |
| schedule_events | id、schedule_item_id、actor_id、from_status、to_status、occurred_at、idempotency_key | 只记录状态迁移；`(schedule_item_id,idempotency_key)` 唯一 |
| fact_versions | id、student_id、schedule_item_id nullable、fact_key、value、source_kind、occurred_at、asserted_at、recorded_at、confirmed_at、confirmed_by、supersedes_fact_version_id、voided_at | 系统事实和人工事实的唯一事实模型；更正创建新版本，不覆盖原版本 |

日程状态为 `pending → completed/skipped/expired/cancelled`；修正通过新事实和新状态事件表达，不能覆盖旧事件。`scheduled_at` 是计划本地日期/时间换算后的 UTC 时刻；`occurred_at` 是实际完成时间；`asserted_at` 是人工声称时间；`recorded_at` 是服务端收到时间；`family_date` 是统计与结算业务日期。

迟完成只允许到计划日次日结束；正向积分的人工补填截止为计划日次日 `18:00`。事实更正窗口为计划日后 7 个家庭自然日；超过窗口仅管理员以安全或数据纠错原因处理。所有截止判断由同一 Time Policy 计算。

## 5. 积分、兑换与投影

| 实体 | 关键字段 | 约束 |
| --- | --- | --- |
| point_rule_templates | id、event_type、parameter_schema、effect_schema、negative_effect_schema、stacking_mode、limits、active | 管理员维护、版本化；模板定义奖扣上限和可叠加性 |
| point_rules、point_rule_versions | id、student_id、creator_parent_id、template_id、active；version、parameters、effect、priority、effective_at | 配置与不可变版本分离；编辑只创建后续版本 |
| settlements | id、student_id、fact_version_id、rule_version_id、settlement_period、result、explanation、idempotency_key | `(fact_version_id, rule_version_id, settlement_period)` 唯一；同实例奖扣互斥由结算策略保证 |
| point_ledger_entries | id、student_id、settlement_id nullable、amount、reason、source_type、source_id、reverses_entry_id nullable、created_by、idempotency_key | 不更新、不删除；冲销必须指向原流水 |
| point_balance_projection | student_id、balance、last_ledger_entry_id、updated_at | 可由流水重建；余额可负 |
| manual_point_rewards | id、student_id、parent_id、amount、reason、ledger_entry_id | 仅正数，且必须有原因 |
| redemption_catalog_items | id、student_id、creator_parent_id、title、cost、monthly_limit、active | 线下文本目录；离关联后停用 |
| point_redemptions | id、student_id、catalog_item_id、cost_snapshot、status、requested_at、confirmed_at、confirmed_by、rejection_reason、ledger_entry_id | pending/approved/rejected/cancelled；批准与扣减流水同事务 |

结算只消费已确认的事实版本；规则只引用系统事实时可立即确认。事实更正不会更新旧结算或旧流水，而是产生冲销结算/流水和基于新事实版本的新结算。负余额拒绝新兑换；每月限次、余额检查、兑换批准和扣减流水必须在同一事务加锁完成。

## 6. 隐私、删除、导出、审计与异步资源

| 实体 | 关键字段 | 约束 |
| --- | --- | --- |
| daily_reflections、daily_reflection_versions | student_id、family_date、visibility、body、version、deleted_at、body_purged_at | `(student_id,family_date)` 对未删除项唯一；删除清除所有正文，保留无正文审计元数据 |
| deletion_requests、deletion_tombstones | resource_type、resource_id、requested_by、status、revocable_until、student_confirmed_at、executed_at；purged_at | requested/frozen/cancelled/executed；tombstone 在备份恢复后优先应用 |
| export_jobs | requester_id、scope_snapshot、status、download_token_hash、expires_at、consumed_at | 权限范围在创建时快照；链接一次性、24 小时 |
| audit_events | actor_id、action、resource_type、resource_id、reason_code、request_id、metadata_schema_version、occurred_at | metadata 只允许类型化、脱敏字段；审计读取也审计 |
| emergency_access_requests、emergency_access_grants | requester、approver、reason、scope、expires_at、status、capability_hash | 申请人与批准人不同；短时精确 scope；每次读取关联 grant |
| outbox_events、worker_attempts | id、aggregate_type、aggregate_id、event_type、event_version、dedupe_key、payload、available_at、leased_until、attempts、status | `dedupe_key` 唯一；pending/leased/processed/dead；Worker 领取采用租约 |

删除请求冻结资源访问；撤销、学生确认或管理员强制执行均写审计。执行后主存储正文清除，备份最长 90 天轮转；安全审计默认保留 3 年，最终期限需上线前合规确认。紧急访问不是管理员常规权限，必须重新认证、双人批准、限时且逐次记录。

## 7. 索引、重建与迁移

- 所有 projection 带最后处理的源事件/流水标识，允许幂等重放。
- outbox 事件由业务事务写入；Worker 指数重试，超过最大次数进入 dead 并告警，人工重放使用新的尝试记录。
- 迁移遵循 expand → deploy → contract；训练定义与规则版本只新增，不重写历史。
