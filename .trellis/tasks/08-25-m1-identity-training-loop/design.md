# M1 技术设计

## 1. 设计原则

- **Module Interface 优先**：Identity、Family Access、Training、Audit 通过命令/查询 Interface 暴露；Route Handler 只做 HTTP 适配、鉴权与 DTO 校验。
- **权威事实在 PostgreSQL**：`relationships`、`student_association_codes`、`training_sessions` 等为事实源；首页/汇总为可重建投影（M1 可同事务更新简化投影）。
- **实时授权**：敏感读取必须查询 `relationships.status = active` 且校验 `authorization_epoch`；禁止仅凭前端路由隐藏。
- **M1 同步边界**：outbox 表随事务写入，M1 处理器可在请求末尾同步 `processOutbox()` 或 no-op；独立 Worker 留给 M3。

## 2. 逻辑架构

```text
Browser (React Client Components — 训练 UI、表单)
  └─ Next.js App Router
       ├─ Route Handlers / Server Actions（鉴权边界）
       └─ Domain Modules
            ├─ identity/
            ├─ family-access/
            ├─ training/
            └─ audit/
                 └─ PostgreSQL (Drizzle)
```

### Module 职责（M1 子集）

| Module | 命令 | 查询 | 禁止 |
| --- | --- | --- | --- |
| Identity | 注册、验证联系方式、登录/登出、创建邀请码、消费邀请、创建学生账号、改密 | 当前用户、邀请状态 | 直接写 relationship |
| Family Access | 生成/撤销关联码、发起/接受/拒绝/解除关联、留存监护同意 | 授权结论、待处理申请 | 绕过 relationship 读训练 |
| Training | 开始/提交/放弃会话、校验指标 | 会话详情、学生汇总、家长汇总 | 信任客户端指标 |
| Audit | append-only 写 | 管理员查审计（只读列表） | 含敏感明文 |

## 3. 数据模型（M1 表）

与 `docs/data-model.md` 对齐的子集：

```
users, families, relationships, family_memberships,
relationship_requests, student_association_codes,
invitations, invitation_redemptions,
guardian_consents, sessions (Lucia),
login_security_events, audit_events,
training_definitions, training_sessions, training_events, training_metrics,
training_profile_projection,
outbox_events (写入，M1 可不消费)
```

### 关键唯一约束（必须在首次迁移中落地）

| 表 | 约束 | 用途 |
| --- | --- | --- |
| `student_association_codes` | `(student_id) WHERE consumed_at IS NULL AND revoked_at IS NULL` 部分唯一 | 同时仅一个有效码 |
| `student_association_codes` | `code_hash` UNIQUE | 防碰撞 |
| `relationships` | `(parent_id, student_id) WHERE status = 'active'` | 防重复 active |
| `relationships` | 业务规则：student 仅一个 active family | 应用 + 可选 DB 触发器或查询约束 |
| `invitation_redemptions` | `(invitation_id, idempotency_key)` | 邀请消费幂等 |
| `training_sessions` | `(student_id, training_key, family_date) WHERE session_kind = 'effective' AND status = 'completed'` | 每日有效训练 |
| `training_sessions` | `idempotency_key` UNIQUE | 提交幂等 |

时间：`family_date` 由 `Asia/Shanghai` 的 Time Policy 模块计算（M1 单函数 `toFamilyDate(utc)`）。

## 4. 核心流程设计

### 4.1 邀请注册

```text
POST /api/admin/invitations → hash(code), store role/expires/max_uses
POST /api/auth/register → validate invitation + role
  → transaction: create user, redemption++, mark invitation used
  → parent: status pending_verification until OTP ok
```

邀请码仅存 `code_hash`；展示一次性明文仅创建时返回。

### 4.2 关联（AC-1、AC-2）

```text
Student: POST /api/association-codes → invalidate prior active code, insert new (expires +10m)
Parent:  POST /api/relationship-requests { code }
  → verify: parent verified, code valid, not consumed, roles ok, no active rel
  → transaction: consume code (consumed_at), insert request pending, audit
Student: POST /api/relationship-requests/:id/accept
  → transaction:
      - lock request + code
      - insert relationship active, family if needed, memberships
      - increment authorization_epoch (parent, student)
      - guardian_consent if first parent
      - audit + outbox
```

**拒绝/过期**：不创建 relationship；家长侧查询学生数据一律 403。

**读授权中间件**：

```typescript
async function requireActiveRelationship(parentId, studentId, sessionEpoch, userEpoch) {
  if (sessionEpoch !== userEpoch) throw Forbidden;
  const rel = await findActiveRelationship(parentId, studentId);
  if (!rel) throw Forbidden;
}
```

### 4.3 反应力训练（AC-3）

```text
POST /api/training/sessions { trainingKey, idempotencyKey }
  → create session active, snapshot definition_version + age_band + family_date
POST /api/training/sessions/:id/events (append-only, client timestamps untrusted for scoring)
POST /api/training/sessions/:id/submit
  → validate transitions, compute metrics server-side
  → if first effective today: session_kind=effective else practice
  → upsert training_profile_projection
  → audit
GET  /api/training/sessions/:id (student)
GET  /api/students/:id/training-summary (parent, requireActiveRelationship)
```

刷新/重新登录走 GET，不依赖客户端缓存。

### 4.4 指标计算（反应力）

- 输入：`training_events` 中刺激呈现与反应事件。
- 过滤：反应时 <100ms 或 >3000ms 标记 invalid，不参与中位数。
- 输出：`median_reaction_ms`、`accuracy` 写入 `training_metrics`；`calculation_version` 固定 `reaction-v1`。

## 5. API 与页面清单（M1）

| 路由 | 角色 | 说明 |
| --- | --- | --- |
| `/register` | 公开 | 邀请码注册 |
| `/verify-contact` | 家长 | OTP 验证 |
| `/login` | 全部 | 登录 |
| `/parent/students/new` | 已验证家长 | 创建 5–12 学生 |
| `/parent/link` | 已验证家长 | 输入关联码 |
| `/student/link-code` | 学生 | 展示关联码 |
| `/student/requests` | 学生 | 接受/拒绝 |
| `/student/training/reaction` | 学生 | 训练 UI |
| `/student/training/:sessionId` | 学生 | 结果页 |
| `/parent/students/:id/training` | 家长 | 汇总只读 |
| `/admin/invitations` | 管理员 | 邀请码 CRUD |

## 6. 技术选型摘要

完整比较见 `research/adr-0003-m1-tech-stack.md`。**待批准推荐栈**：

- Next.js 15 App Router + TypeScript
- PostgreSQL 16 + Drizzle ORM + drizzle-kit 迁移
- Lucia v3 会话 + Argon2 密码哈希
- Zod 请求校验
- Vitest（Module/DB 集成）+ Playwright（E2E）
- Tailwind CSS

### 选型理由（一句话）

| 层 | 推荐 | 理由 |
| --- | --- | --- |
| Web | Next.js | 与 architecture 一致，单仓 Route Handler 即 Module 边界 |
| ORM/迁移 | Drizzle | 轻量 SQL 迁移，易表达部分唯一索引与 epoch |
| Auth | Lucia | 多凭据类型 + DB session，贴合 epoch 撤权 |
| 测试 | Vitest + Playwright | 授权/幂等单元测 + 刷新/E2E 验收 |

## 7. 安全与合规（M1）

- 密码 Argon2id；邀请码/关联码随机 ≥128 bit，存 hash。
- Rate limit：登录、OTP、关联码尝试 — PostgreSQL sliding window 或内存 token bucket（单实例 M1 足够）。
- 日志与审计不含明文 secrets。
- 开发 OTP：`ConsoleVerificationProvider`；生产 provider 待 ADR 扩展。

## 8. 目录结构（批准后初始化）

```text
brainDance/
├── docker-compose.yml          # postgres:16
├── package.json
├── drizzle.config.ts
├── src/
│   ├── app/                    # Next.js routes & pages
│   ├── modules/
│   │   ├── identity/
│   │   ├── family-access/
│   │   ├── training/
│   │   ├── audit/
│   │   └── time-policy/
│   ├── db/
│   │   ├── schema/
│   │   └── migrations/
│   └── lib/                    # lucia, errors, idempotency
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── scripts/
    └── seed-m1.ts              # admin + reaction definition
```

## 9. 与后续里程碑的兼容

- **M2**：Schedule & Facts Module 新增 `src/modules/schedule/`，复用 Drizzle schema 与 Time Policy。
- **M3**：`outbox_events` 已有；新增 `src/worker/` 消费；Lucia session 不变。
- **M4**：Family Access 扩展多 relationship；epoch 逻辑已就绪。
- **M5**：Training Module 增加 Stroop/数字广度 definition seed，投影键已含 version/age_band。

## 10. 回滚

- 应用：关闭注册路由、撤销全部 active invitations、部署上一版本。
- 数据：M1 迁移仅 expand；回滚应用不自动 contract 迁移；必要时标记 `users.status=disabled`。
- 功能开关（可选 env）：`REGISTRATION_ENABLED=false`。

## 11. 待批准项

- [ ] ADR-0003 技术栈组合
- [ ] M1 管理员 TOTP 延后（仅 seed admin）是否接受
- [ ] 学生开户默认演示路径 A，路径 B 是否同里程碑必须交付
