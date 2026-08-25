# ADR-0003 草案：M1 最小可行技术栈

- **状态**：提议（待批准）
- **日期**：2026-08-25
- **决策者**：项目负责人
- **复审触发条件**：M2 引入 Worker/多实例部署、团队规模 >3 全栈、或选定云厂商 PaaS 强制特定框架时。

## 背景

`docs/architecture.md` 已方向性选择 TypeScript 全栈 Web + PostgreSQL + SQL 迁移 + 经验证会话库，但未锁定具体库。M1 需要最小闭环，同时不阻碍 M2–M3 的事务 outbox、Module 边界与授权纪元。ADR-0001 已定大陆单区域托管 PostgreSQL，本 ADR 只选应用层栈。

## 决策（推荐组合）

| 层 | 选择 | 版本策略 |
| --- | --- | --- |
| 应用框架 | **Next.js（App Router）单仓 monolith** | 15.x LTS 轨道 |
| 语言 | TypeScript strict | 与框架一致 |
| 数据库 | PostgreSQL 16 | 本地 Docker + 托管 |
| 访问层 + 迁移 | **Drizzle ORM + drizzle-kit** | SQL 迁移入库 |
| 身份认证 | **Lucia v3** + `@node-rs/argon2` | 自建 sessions 表 |
| 校验 | Zod | 边界 DTO |
| 单元/集成测试 | **Vitest** + `pg` test DB | 每 PR |
| E2E | **Playwright** | 覆盖 AC-1–3 |
| 样式 | Tailwind CSS + 少量 headless 组件 | 移动优先 |

## 选项比较

### 1. Web 应用框架

| 选项 | 优点 | 缺点 | M1 结论 |
| --- | --- | --- | --- |
| **Next.js App Router** | 与 architecture 一致；RSC/Route Handlers 可同仓；大陆生态与部署选择多 | 框架较重；需纪律避免逻辑泄漏到 Client Component | **推荐** |
| Remix | 数据加载模型清晰；表单友好 | 团队熟悉度与大陆部署样例较少；与现有 architecture 文档不一致 | 不选 |
| Vite + Express/Fastify 分离 | 前后端边界最清晰 | M1 需双倍脚手架与鉴权接线；SSR/SEO 非 M1 刚需但增加运维面 | 不选 |
| NestJS 独立 API + SPA | 企业化 Module 边界 | 两个部署单元与 CORS/会话共享成本；M1 过度 | 不选 |

### 2. PostgreSQL 迁移工具

| 选项 | 优点 | 缺点 | M1 结论 |
| --- | --- | --- | --- |
| **Drizzle + drizzle-kit** | 轻量；迁移为 SQL；Schema 即 TypeScript；易写部分唯一索引 | 生态小于 Prisma；复杂迁移需手写 SQL | **推荐** |
| Prisma | 迁移 DX 好；Studio 调试 | 抽象厚；部分索引/约束表达繁琐；生成的 client 体积大 | 备选 |
| node-pg-migrate / Flyway | 纯 SQL 可控 | 无类型安全 Schema；TS 实体需重复维护 | 不选 |
| TypeORM | 熟悉度高 | 迁移与装饰器魔法多；活跃维护感知弱于 Drizzle | 不选 |

### 3. 身份认证

| 选项 | 优点 | 缺点 | M1 结论 |
| --- | --- | --- | --- |
| **Lucia v3** | Session 存 DB；易挂 `authorization_epoch`；支持多 credential（家长 email/phone、学生 username） | 需自建注册/验证流程 | **推荐** |
| Better Auth | 内置邮箱验证、插件化 | 较新；多角色 + 学生用户名模式需验证；epoch 撤权需自定义 | 备选 |
| Auth.js (NextAuth) | 集成快 | OAuth 导向；学生用户名/家长手机验证模型不贴合 | 不选 |
| 纯自定义 cookie session | 最少依赖 | 重复实现旋转、固定、锁定、epoch | 不选 |

### 4. 测试

| 选项 | 优点 | 缺点 | M1 结论 |
| --- | --- | --- | --- |
| **Vitest + Playwright** | 同 TS 工具链；Vitest 跑 Module/DB 集成快；Playwright 验 AC | 需 docker-compose Postgres | **推荐** |
| Jest + Cypress | 成熟 | Jest ESM/Next 配置更重；Cypress 对多 tab/epoch 较弱 | 不选 |
| 仅 Playwright | 实现快 | 授权/幂等/DB 约束回归慢且脆 | 不选 |

## 后果

- 单仓 Next.js Route Handlers 作为 Identity / Family Access / Training Module 的 HTTP Interface；Module 纯函数 + repository 层便于 Vitest 单测。
- Lucia session 表增加 `authorization_epoch` 字段，读取敏感 Route 比较 session 与 user 当前 epoch。
- Drizzle 迁移纳入 CI：`drizzle-kit generate` + `migrate` 对 test DB 跑全量。
- M3 引入 Worker 时，可新增 `apps/worker` 包或同仓 `src/worker` 入口，共享 Drizzle schema；无需更换 ORM。
- 大陆 SMS/邮件：M1 抽象 `VerificationProvider` 接口，开发用 ConsoleProvider，生产 ADR 扩展。

## 被拒绝选项（摘要）

- **Prisma + NextAuth**：上手快但 Domain 模型（学生用户名、epoch 撤权、邀请码哈希）适配成本高。
- **分离 SPA + API**：M1 运维与 auth 传递复杂度不值得。
- **MongoDB / SQLite 生产**：与 data-model relational 约束与 ADR-0001 PostgreSQL 冲突。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Next.js 逻辑散落 Client | 规则：敏感读写在 Server Component / Route Handler only；ESLint 禁 client fetch 敏感 API |
| Lucia 维护度 | 会话表自有 schema；边界薄，可替换为 Better Auth |
| Drizzle 复杂约束 | 关键唯一索引用 raw SQL migration 文件 |
| 管理员 TOTP 延后 | M1 seed admin 仅本地；生产 checklist 阻断项明确 |

## 批准后将执行

1. 将本文件复制为 `docs/adr/0003-m1-tech-stack.md` 并标记「已接受」。
2. 更新 `docs/README.md` 决策记录索引（需单独变更任务或 M1 实现 PR 附带）。
3. 初始化仓库骨架（package.json、docker-compose、CI）——**仅在实现阶段，不在本规划任务**。
