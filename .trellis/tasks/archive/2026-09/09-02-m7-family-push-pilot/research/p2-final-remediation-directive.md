# M7 P2 最终集中整改唯一指令

## 固定交接

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 分支：`feat/m7-family-push-pilot`
- 首次整改基线：`1fe141cbac5b01b8d76c122c05124edb3758a417`
- 被复验提交：`dd7b350899b9039ab06d7e1f492b2f6a69ab85fe`
- 复验结论：NO-GO。
- 本文件只收敛原 `p2-remediation-directive.md` 中尚未满足的 F02～F06，不新增或移动验收线。

开始前核对分支、完整 HEAD、本文提交后的完整整改基线 SHA 与干净工作区。不修改 PRD/design/implement、P1 签署、两份整改指令或任务状态；不 pull/fetch、切分支、建 worktree、merge、rebase、reset、push 或部署。

## P2-FF01 关闭 purge prepare 与重新引用竞态（P2-F03/F06）

- 当前 prepare 只把 intent 标为 `prepared`，media 仍为 `ready`；attach 可在外部物理删除期间重新引用并取消 intent，finalize 又因 `reference_count > 0` 跳过，形成 ready + active reference 但对象已删除。
- 用 media 行锁与可持久化 fencing/不可附加状态关闭竞态：prepare 成功后，新 attach 不得与已开始的物理删除并行成功；重新引用只允许在 physical purge 尚未取得清理所有权时原子取消 pending 清理。
- finalize 必须验证同一 purge generation/ownership 或等价不变量，不能只凭引用数判断；失败重试与重复 Worker 必须收敛。
- 增加真实并发交错测试：attach 先赢则 purge 不删除；prepare 先赢则 attach 不成功；不得出现 active reference 指向已删对象。

## P2-FF02 瞬态上传失败必须可恢复（P2-F02/F06）

- staging 写失败、scanner error/timeout、promote 失败属于瞬态失败，不得永久进入 `rejected` 并让相同 key 永久返回 `MEDIA_REJECTED`。
- 非法内容、恶意内容、确定性解码/重编码失败可 rejected；瞬态基础设施失败保留明确 recoverable 状态与安全错误类别，相同 key + 相同 payload 可续跑，不同 payload 冲突。
- 注入真实的 promote 成功后 DB finalize/audit 事务失败，证明首次无 ready-without-audit，随后相同 key 重试收敛为单一 ready + 单一 audit；不得以手工插入 processing 行替代该证据。
- 覆盖 staging/scanner error/promote/finalize 各瞬态失败后的同 key 恢复。

## P2-FF03 capability 签发也必须实时解析角色（P2-F04）

- `issueMediaReadCapability` 不得信任调用方传入的 `actorRole`；通过 Identity 明确 service/interface 由 `actorId` 实时解析角色，并执行资源授权。
- 删除该参数，或显式忽略并核对它；Route/调用方同步收敛，不能留下可伪造授权入口。
- 增加伪造 role、目标学生、冻结、另一当前家长、无关家长的签发与签发后读取矩阵，错误不得泄露资源存在性。

## P2-FF04 tombstone 恢复与失败证据必须真实（P2-F05）

- 测试中真实恢复正文、active reference、live capability 与 ready media（或等价的一组可读权威事实），再通过正式 tombstone replay 入口清除；不得只重复调用 purge 函数。
- 注入删除业务事务中途失败，证明所有正文清理、ref/cap revoke、media 状态、purge intent/outbox 与 audit 一起回滚；重试后收敛。
- 重复 replay 不得重复 audit/outbox，canary 必须证明恢复事实再次被清除，且敏感正文/key/URL/token/bytes 不进入 payload/log/error。

## P2-FF05 修正迁移安全与其证据（P2-F01/工程规范）

- `0030_m7_media_student_binding.sql` 不得静默 `DELETE` 无法回填的媒体事实；历史事实不得无审计丢弃。
- 对合法旧 key 可核验回填；无法唯一回填时迁移必须显式失败并给出非敏感诊断，或采用 expand → deploy → contract 的后置 contract 方案。本阶段不得以删除异常行使 NOT NULL 通过。
- 增加迁移聚焦测试/验证：合法旧行正确绑定；不可回填旧行不会被静默删除；已有 reference/intent/capability 不被破坏。

## P2-FF06 修正虚假或缺失测试证据（P2-F01/F06）

- 将顺序执行的“concurrent upload”改为受控 barrier 的真实并发事务；补充并发重复 attach，断言唯一引用、准确 reference_count 与确定错误收敛。
- 增加尺寸/像素炸弹测试。
- dead replay 不得使用 `processed || !processed` 恒真断言，必须断言 intent/media/object/audit 的最终状态与幂等数量。
- P2 E2E 保存删除前已签发 capability，并在删除后重放，断言不可读；继续保留 desktop/mobile 图片可读、图片作答、失败恢复、无横向滚动与 `finally` 清理。

## 验证与交付

- 只运行新增/受影响核心媒体集成测试、迁移聚焦验证及 P2 media 双视口 E2E；不要运行全量 test/build/lint/typecheck。`git diff --check` 必须 clean。
- 更新 `research/p2-implementation-record.md`，逐项记录 P2-FF01～FF06 的代码、测试、精确命令结果与未运行项；不得把模拟/恒真断言写成已验证。
- 只创建一个聚焦最终整改提交；不扩展产品范围或生产供应商。
- 回报完整 HEAD、完整整改基线、被复验 SHA、FF01～FF06 证据、聚焦测试结果和工作区状态，结尾写“已交 P2 最终复验”。
