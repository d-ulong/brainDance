# M7 P2 集中整改唯一指令

## 固定交接

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 分支：`feat/m7-family-push-pilot`
- 被审核提交：`61926b4d8d37e27b7a4c247db9e2a31abfc10541`
- 整改基线：由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 审核结论：NO-GO；本文件一次性冻结 P2 阻断项，验收线不再追加。

开始前核对分支、HEAD、基线与干净工作区。不得修改 PRD/design/implement、P1 签署、本指令或任务状态；不 pull/fetch、切分支、建 worktree、merge、rebase、reset、push 或部署。

## P2-F01 媒体必须权威绑定目标学生

- `media_objects` 必须保存不可歧义的 `student_id` FK；上传幂等 payload、查询索引、DTO/审计元数据和 staging/safe key 均以该归属为基础。
- attach 时必须在锁内同时验证 media 为 ready、未撤销、上传者等于 actor、`media.student_id` 等于资源目标学生；禁止同一家长把为学生 A 上传的对象附到学生 B。
- reference 的 student/resource/version/purpose 必须与实际 push/answer 权威链一致，不能只信调用方参数。增加跨学生、跨资源、错误 purpose、非上传者和并发重复 attach 的数据库测试。

## P2-F02 上传状态机、幂等恢复与事务原子性

- 当前 ready 更新与 `media.uploaded` audit 分离，且 staging/processing 的同 key replay 会永久返回半成品。重构为可恢复状态机：外部 staging/scan/reencode/promote 不伪装成数据库原子事务；最终 ready 权威写入、metadata-only audit 及必要 outbox 必须同一短事务完成。
- 任一步骤崩溃/超时后，相同 key + 相同 payload 必须安全续跑或收敛为明确可重试状态；不同 payload 冲突。不得把 staging/processing 当作成功 replay。
- promote 成功而数据库 finalize 失败时必须可补偿或由幂等重试收敛，不能留下无记录/不可清理 safe object；审计失败不得留下无审计 ready 业务事实。
- Route 必须在物化完整 multipart 字节前实施可执行的请求体/文件大小上限；仅在 `formData()` 后检查 `File.size` 不能作为 10 MiB 内存防护。拒绝错误不得记录文件名、字节或 token。

## P2-F03 物理清理不能位于数据库事务内

- `handleMediaPurgeRequestedV1` 当前持有 DB 锁/事务执行对象存储 I/O；DB 回滚可能造成对象已删而权威状态仍 ready。改为明确的 prepare/physical purge/finalize 状态机或等价模式。
- prepare 短事务锁定并验证到期、零引用、状态和 intent；物理删除在事务外幂等执行；finalize 短事务再次锁定复核并原子写 purged、intent completed、metadata-only audit/outbox。
- safe/staging 任一删除失败时 intent 保持 pending/retryable，并记录安全错误类别；重复 Worker、lease expiry、dead replay、物理删除成功后 finalize 失败必须最终收敛且不恢复可读。
- `revokeSafe` 不得等同物理删除来实现普通撤权；普通读取由引用/能力/状态拒绝，物理对象遵守 90 天生命周期。

## P2-F04 模块边界与实时能力授权

- `media-capability.service.ts` 不得直接读取 Identity 的 `users` 权威表；authorization epoch 与 actor role 通过 Identity 明确 service/interface 获取。
- 签发与读取均验证 capability 的 media/reference/student/actor 绑定彼此一致，reference 指向当前合法资源版本，媒体 ready 且归属同一学生；对篡改或交叉组合返回不泄露错误。
- 增加目标学生、创建家长、另一当前家长、无关家长、离关联、冻结、epoch 改变、引用撤销、资源删除、token 到期/篡改的签发后再次读取测试。验证已签发 token 在撤权后立即失败。

## P2-F05 删除/tombstone 与媒体恢复防复现

- 账户删除/重放必须在同一业务事务内产生可追踪的 purge intent/outbox；`family_content.purged` 的幂等键不得依赖可变化的调用时间导致每次 replay 重复审计。
- canary 不得以 `void mediaObjects` 代替验证：必须证明无可读正文、active reference、live capability，且已删除学生的 staging/safe 对象进入正确撤权/清理状态；重建/人为恢复数据库行后再次 tombstone replay 仍清除。
- 覆盖删除中途失败、tombstone 重放、重复重放、投影/行恢复 canary，断言审计/outbox 不重复且正文、key、URL、token、字节不进入 payload/log/error。

## P2-F06 补齐核心媒体与双视口证据

- 当前集成测试只有 4 个大场景，需补齐：JPEG/PNG/WebP 正例；截断、畸形、尺寸/像素炸弹、扫描 error、解码/重编码失败、staging write/promote/finalize 失败；原始对象不可读与清理。
- 生命周期覆盖共享引用、90 天前不 purge、到期 purge、失败重试、重复 Worker/dead replay、重新引用取消清理；不得直接改数据库时间后只调用 handler 代替 Worker 证据。
- P2 E2E 必须在 desktop/mobile 真实断言图片可见/可读、图片作答、异常文件失败可恢复、删除后既有媒体能力不可读及无横向滚动；临时文件在 `finally` 清理，不能遗留测试文件。
- 仅运行本轮新增/受影响核心聚焦测试及 P2 media 双视口 E2E；不要运行全量 test/build/lint/typecheck。`git diff --check` 必须 clean。

## 交付

- 更新 `research/p2-implementation-record.md`，新增集中整改映射 P2-F01～F06、状态机/补偿、事务边界、威胁矩阵、精确命令结果和 deferred。
- 只创建一个聚焦整改提交，包含必要 migration、业务修正与测试；不得扩展到生产供应商、PDF/SVG/GIF/视频/AI/OCR。
- 回报完整 HEAD/基线/被审核 SHA、P2-F01～F06 证据、文件/依赖、聚焦测试结果和工作区状态，结尾写“已交 P2 最终复验”。
