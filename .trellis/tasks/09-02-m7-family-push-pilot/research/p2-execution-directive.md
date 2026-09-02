# M7 P2 唯一执行指令：受控图片与删除/恢复闭环

## 固定交接

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 分支：`feat/m7-family-push-pilot`
- P1 签署：`research/p1-signoff.md`，签署 SHA `529330b1e141dd0210d738e4c05cb5edfb0fef39`
- 执行基线：由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 范围：仅 P2；R-M7-05～06、AC-M7-05～06，并为最终 AC-M7-09 提供本阶段证据。

开始前核对分支、HEAD、基线和干净工作区。不 pull/fetch、不切分支、不创建 worktree；不处理基线外未知变更。

## 必读依据

1. `prd.md` 的 R-M7-05～06、AC-M7-05～06、AC-M7-09
2. `design.md` §2、§4～8，`implement.md` P2
3. `CONTEXT.md` 的推送图片限制、内容媒体清理、推送作答
4. `docs/user-flows.md` §6 与 `.trellis/spec/backend/`、`.trellis/spec/frontend/` 相关规范
5. P1 已签署实现；只能扩展媒体能力，不得改写 P1 状态机、授权语义或文本/链接行为

## P2-R01 权威媒体模型与存储 seam

- 新增 expand migration/schema：media object、resource-bound reference、purge intent/状态及必要版本/幂等字段；用 PostgreSQL check/unique/FK 固定状态、引用唯一、ready 可读、purge 资格与时间不变量。
- `PrivateMediaStore` 只定义 staging put/read/delete、safe object promote/read/revoke/purge 等最小能力；测试 adapter 使用受控临时目录或内存，路径必须防穿越。
- 不绑定生产供应商、bucket、密钥、DPA 或数据驻留配置；这些保持上线 blocker。

## P2-R02 fail-closed 图片管线

- 仅接受 JPG/JPEG、PNG、WebP，单文件硬上限 10 MiB；同时核对声明 MIME、magic bytes、完整解码与合理尺寸/像素上限，拒绝伪装、截断、解码炸弹、PDF/ZIP/SVG/音视频/任意附件。
- 原始字节只进入不可读 staging；先经可替换 `MediaScanner` 接口返回 clean/rejected/error，再统一解码重编码生成安全派生对象；只有 clean + 重编码 + promote 全部成功才能事务标记 ready 并建立引用。
- 扫描或重编码不可使用“永远 clean”的生产默认实现。测试可注入确定性 scanner；生产未配置时上传 fail-closed。
- 如仓库缺少可靠图片解码/重编码能力，允许仅新增一个直接依赖 `sharp`；不得增加供应商 SDK或无关依赖，并在实施记录说明必要性与锁文件变化。

## P2-R03 推送/作答集成与实时读取授权

- 家长可在创建/编辑未发布推送时附加已 ready 图片；学生可在已发布 active 推送的新版作答中附加图片/手写图片。普通读取只返回资源绑定的媒体 DTO，不返回永久公开路径或对象 key。
- 图片版本与 P1 文本版本同生效边界：失败不得留下半成品正文版本或可读引用；重放/并发不得重复引用或 orphan ready 对象。
- 媒体读取能力必须短 TTL，绑定 media id、引用资源、请求主体及 authorization epoch；每次签发和实际读取都实时复核目标学生、active relationship、冻结、资源状态/版本和引用仍有效。无权与不存在不泄露。

## P2-R04 删除、撤权、90 天清理

- 推送或作答删除/替换导致引用失效时，同一事务立即撤销普通媒体读取；引用归零时幂等写 purge intent，`purge_after = unreferenced_at + 90 days`。
- Worker 仅在到期、引用仍为零且对象仍符合清理状态时物理 purge；使用现有租约、幂等、有限重试和 dead/replay。失败保留可重试状态，成功不得复现。
- 离关联或冻结立即阻止能力签发/读取，但不错误删除仍被家庭资源引用的对象。

## P2-R05 账户删除、tombstone 与恢复防复现

- 通过 Data Lifecycle 的明确 service/interface 接入学生账户删除和 tombstone replay；不得由 Family Content 直接写其他模块权威表。
- 删除步骤清除 M7 正文/版本可读内容、取消预约、撤销所有媒体引用/能力并登记清理；tombstone 重放必须先于投影重建再次执行。
- 用恢复 canary 证明已删正文、原始 staging、安全派生对象和读取能力不会因 replay/rebuild 恢复可读；失败可重放且状态可解释。

## P2-R06 Route、UI 与隐私

- Route 保持薄层；multipart/上传会话、完成、读取能力和删除命令均校验大小、类型、UUID、幂等键与授权。错误/log/audit/outbox/notification 不得包含正文、原始文件名、对象 key、媒体 URL/能力 token 或图片字节。
- 家长 UI 支持推送图片选择、校验/扫描/处理状态、失败重试与预览；学生 UI 支持图片/手写图片作答及失败恢复。不得把失败上传误显示为已发布/已提交。
- desktop Chromium 与 360×800 覆盖图片推送、图片作答、拒绝异常文件、删除后立即不可读和无横向滚动。

## 必须测试的核心矩阵

- migration/invariant：状态、引用唯一、ready/purge 资格、并发去重。
- 管线：允许格式正例；声明/实际不符、超限、截断、扫描拒绝/错误、解码/重编码/promote 失败；原始对象始终不可家庭读取。
- 授权：目标学生、创建/另一当前家长、无关/离关联家长、冻结、epoch 变化、删除引用；签发后撤权再次读取必须失败。
- 生命周期：共享引用、归零、90 天前拒绝 purge、到期 purge、重复 Worker/dead replay、失败恢复。
- 删除恢复：学生账户删除、tombstone 重放、投影恢复 canary，正文/媒体/token 不复现。
- 隐私：audit/outbox/log/error/notification 无正文、文件名、key、URL、token 或字节。

## 验证策略与交付

- 开发期间只运行新增/受影响核心代码的 migration、media、family-content、data-lifecycle、outbox 聚焦测试及 P2 双视口 E2E；不要机械重复全量 test/build。
- 最终 AC-M7-09 的全量 test、typecheck、lint、format、build 和完整双视口 E2E 留给 P2 签署/合并门，除非聚焦验证不足或共享基础设施变更要求提前扩大；扩大须说明原因。
- 新建 `research/p2-implementation-record.md`，映射 P2-R01～R06、R/AC-ID、schema/事务/锁序、媒体威胁矩阵、删除顺序、命令结果与 deferred 上线 blocker。
- 只创建一个聚焦 P2 业务提交。不得修改 PRD/design/implement、本指令、P1 签署或任务状态；不得 merge/rebase/reset/push/deploy。
- 回报完整分支/HEAD/基线、P2-R01～R06 证据、文件与依赖、聚焦命令结果、`git status --short --branch`、blocker/deferred，结尾写“已交 P2 审核”。

## 禁止事项

- 不支持 PDF、SVG、GIF、压缩包、音频、视频、任意附件、外链预览、AI/OCR/语音或系统级推送。
- 不复用导出 artifact 的一次性下载业务语义，不开放永久公共 URL，不保留可读原始上传。
- 不伪造恶意文件扫描成功，不关闭生产媒体供应商/合规/密钥/驻留/真实演练 blocker。
