# M1 已知遗留风险（Identity Phase 完成后记录）

| 项 | 说明 | 目标处理里程碑 |
| --- | --- | --- |
| 管理员 TOTP | 未实现；admin 仅密码登录 | M3 或上线阻断项 |
| IP 级限流 | 仅账号维度登录失败锁定 | Identity 增强 / M3 |
| 生产 OTP/SMS | 开发模式返回 `devOtp`；无真实 Provider | 上线前 ADR 扩展 |
| Lucia 弃用 | `lucia` / `@lucia-auth/adapter-drizzle` 包已 deprecated | M3 前评估迁移 |
| SESSION_SECRET | 本地可为占位值；生产必须轮换 | 部署前 |
| 13–18 学生自助注册 | 仅 parent 邀请注册路径已实现 | M1 Identity 续 |
| 注册/验证 UI | 仅 HTTP API，无前端页面 | M1 闭环验收前 |

## Family Access Phase 完成后追加

| 项 | 说明 | 目标处理里程碑 |
| --- | --- | --- |
| 多家长 / 解除关联 | M1 仅单家长单学生；无 ended 流程与 UI | M2+ |
| `family_memberships` 投影 | 授权以 `relationships.status=active` 为准；投影仅同事务维护，不得单独放行 | 后续模块读取须继续走 `requireActiveRelationship` |
| 关联码并发签发 | 新码会 revoke 旧未消费码；DB 部分唯一索引约束每生仅一条 active 码 | 若需保留多码并存需改产品规则 |
| 申请 72h TTL | `relationship_requests.expires_at` 仅在 accept/reject 路径校验；无后台 sweep | 后续 cron 或读时 lazy expire |
| 集成测试串行 | 共享 DB + TRUNCATE，`vitest` 设 `fileParallelism: false` | 并行需 testcontainers 隔离或 schema 分片 |
| API 层 E2E | Family Access 仅有服务层集成测试；HTTP 路由未覆盖 Playwright | M1 闭环验收前 |

## Training Phase 完成后追加

| 项 | 说明 | 目标处理里程碑 |
| --- | --- | --- |
| 训练 UI | 仅有 HTTP API；无 `/student/training/reaction` 页面 | M1 闭环验收前 |
| Stroop / 数字广度 / 趋势 | 按范围排除 | M5 |
| 失焦检测 | 客户端上报 `session.blur.durationMs`；无浏览器 Page Visibility 集成 | 训练 UI 阶段 |
| 每日 effective 竞态 | 事务内 advisory lock + 部分唯一索引双保险 | 高并发下观察 |
| E2E 端口 | Playwright 默认用 3001 dev server，避免与本地 `pnpm dev` 冲突 | CI 用 build+start |
| outbox / 解除关联 | PRD/design 要求 outbox 占位与解除关联；M1 未实现表与 API | M3 / M4 |
| guardian_consents | 已实现：首次 accept 写入 `policy-v0.1-m1` + 审计 `guardian_consent.recorded` | — |
