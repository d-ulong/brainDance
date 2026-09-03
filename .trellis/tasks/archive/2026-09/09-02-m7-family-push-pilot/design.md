# M7 家庭推送试点技术设计

## 1. 模块边界

新增 `Family Content` 深模块，拥有推送、作答、评论、正文版本和媒体引用权威表。Route 保持薄层；所有写入经模块 service 在同一事务内完成权威记录、审计和 outbox。模块通过既有 Family Access 接口实时授权，通过 Data Lifecycle 接口接入冻结、删除和 tombstone，不直接写其他模块权威表。

站内通知由 Notification 边界消费版本化领域事件生成；通知 payload 只保存通用类型、主体和资源 opaque id，不复制正文。

## 2. 权威模型

- `family_pushes`：student、creator parent、状态、publish/schedule 时间、当前正文版本、幂等字段。
- `family_push_versions`：不可覆盖的文本与原始 URL 版本；编辑只新增版本。
- `push_answers` / `push_answer_versions`：目标学生的作答聚合及不可覆盖版本。
- `push_comments` / `push_comment_versions`：作者、可选 parent comment、当前版本、删除状态。
- `media_objects` / `media_references`：上传主体、内容 hash、状态、扫描/重编码元数据、对象 key、引用与 purge 时间；正文表只引用 ready 媒体。

数据库约束固定状态枚举、版本唯一、发布幂等、引用唯一及清理资格。历史正文不得复制到审计或 outbox。

## 3. 发布与 Worker

立即发布与预约发布共享同一事务命令。预约状态写 `family_push.publish_requested` outbox；Worker 按 stable publish key 领取，锁定推送并检查 creator relationship、student freeze 和状态后切换 published，同时写一次通用通知事件。关系结束事务调用 Family Content 接口取消该创建者的 scheduled 推送。

Worker 使用现有租约、有限重试、dead/replay 和 attempt 证据；同一推送最多一次 published transition 和一次发布通知。

## 4. 授权与撤权

写入和敏感读取实时检查目标学生的 active relationship、作者身份和冻结状态。学生只能读取自己的目标推送并提交自己的作答；家长只能访问当前关联范围。创建家长离关联后立即失去访问，未发布预约取消；已发布历史仍由剩余家庭成员读取。

媒体访问能力绑定 media id、资源引用、请求主体、authorization epoch 与短 TTL；读取前再次验证引用资源仍可读。列表投影或签发能力不构成授权事实。

## 5. 媒体管线

上传先进入不可读 staging key，限制 10MB 并检查 magic bytes、解码尺寸和允许格式；扫描成功后统一重编码为安全 JPG/PNG/WebP 派生对象，再以事务标记 ready。扫描失败、格式伪装、解码炸弹或重编码失败均 fail-closed 并清理 staging。

对象存储通过独立 `PrivateMediaStore` seam 提供 staging put、promote/read、revoke、purge；本地测试 adapter 使用受控目录，生产 provider 单独 ADR。日志只记录 opaque media id、状态和错误类别。

## 6. 删除与恢复

推送、作答或评论删除先在事务中撤销普通读取并写 purge intent；media reference 归零后设置 90 天 `purge_after`。Worker 到期物理清理，失败保留 pending intent 并可重放。学生账户删除步骤清除 M7 正文/版本、撤销媒体能力、取消预约；tombstone replay 先执行这些清除，再允许其他投影重建。

## 7. 兼容与回滚

迁移采用 expand → deploy → contract；新入口以功能开关控制。P1 可关闭创建/发布并停止 Worker，保留历史只读；P2 媒体故障时关闭上传但保留文本/链接。不得通过回滚恢复已删除正文或已撤销媒体。

## 8. 风险与 deferred

主要风险是媒体绕过扫描、短时链接撤权滞后、正文进入日志/outbox、离关联仍可访问和 tombstone 漏清。生产对象存储、扫描供应商、DPA、数据驻留、密钥及真实生产媒体演练保持上线 blocker。
