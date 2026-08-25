# M1 验收缺口修复 — 验证证据

> **任务**：`08-25-m1-verification-remediation`（分支 `fix/m1-verification-gaps`）  
> **验收日期**：2026-08-25  
> **基线提交**：`117038211ffc966fb5405b0832d4434b2e8f7c64`  
> **说明**：本文档记录**本修复任务**的首次验收结果。历史任务 `08-25-m1-identity-training-loop/` 内文档与其 `research/m1-verification-evidence.md` **只读、未改写**。  
> **独立复验入口**：[`../VERIFICATION.md`](../VERIFICATION.md) → 填写 [`reverification-signoff.md`](./reverification-signoff.md)

## 1. 验收矩阵

| 需求 | 实现要点 | 自动化测试 | 浏览器/UI 证据 | 状态 |
| --- | --- | --- | --- | --- |
| **P1-1 / R1** 训练幂等键按学生隔离 | 迁移 `0005`；`(student_id, key)` 复合唯一；`IDEMPOTENCY_SESSION_MISMATCH` 409 | `tests/integration/training/idempotency-scope.test.ts`（3 用例） | —（API 层） | ✅ |
| **P1-2 / R2** 浏览器可操作 M1 主路径 + 360px | Next.js 页面 `/`、认证、家庭、训练、家长汇总；`PageShell` + `apiFetch` | `tests/e2e/m1-browser-flow.spec.ts`（桌面 + mobile-360 全路径）；`tests/e2e/training-flow.spec.ts`（API 回归） | 截图见 §4；E2E 断言 `parent-metric-*`、训练完成、解除后 403 | ✅ |
| **P1-3 / R3** 单方解除关联 | `end-relationship.service.ts`；`POST /api/relationships/:id/end`；epoch++ / membership.left_at / audit / outbox | `tests/integration/family-access/end-relationship.test.ts`（7 用例） | E2E：解除关联 → `parent-forbidden` + API 403 | ✅ |
| **P1-4 / R4** 事务 Outbox 占位 | 迁移 `0006`；`append-outbox-event.ts`；注册/accept/end/submit 同事务 | `tests/integration/outbox/outbox-transaction.test.ts`（8 用例） | — | ✅ |
| **P2-5 / R5** Prettier / CI 格式 | 全库 `pnpm format` 通过 | CI 命令 `pnpm format` | — | ✅ |
| **P2 / R6** 受控学生 + 首次强制改密 | 迁移 `0007`；`POST /api/family/students`；`POST /api/auth/change-password`；`password-change-guard` 门禁写 API | `tests/integration/identity/controlled-student.test.ts`（3 用例） | E2E：初始密码登录 → `/student/change-password` → 训练 | ✅ |
| **R7** 管理员 TOTP | **不实现**（延期） | — | — | ⏸ 见 `m1-deferrals.md` |

### R6 最终决定（受控学生路径）

- **路径 A（5–12 岁家长受控开户）**：**已实现** — 家长创建学生、`must_change_password=true`、首次登录强制改密后方能训练/关联写操作。
- **路径 B（13–18 自助邀请注册）**：**延期** — 见 `research/m1-deferrals.md` §2。

## 2. 自动化测试结果（2026-08-25 最终验收）

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | **53/53 通过**（12 文件） |
| `pnpm test:e2e` | **10/10 通过**（desktop-chromium ×5 + mobile-360 ×5） |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过（26 路由） |
| `pnpm format` | 通过 |
| `git diff --check` | 无空白/冲突标记问题 |

### E2E 用例明细

| 用例 | 项目 | 说明 |
| --- | --- | --- |
| `home.spec.ts` | desktop + mobile | 首页渲染、health API |
| `m1-browser-flow.spec.ts` → full M1 path | desktop + mobile | **UI 控件**完整八步主路径（非 request.post 替代） |
| `m1-browser-flow.spec.ts` → horizontal scroll | desktop + mobile | 360×800 无横向滚动 |
| `training-flow.spec.ts` | desktop + mobile | API 级训练持久化 + 家长汇总回归 |

## 3. 实现 ↔ 测试映射（按 Phase）

| Phase | 交付 | 主要文件 | 测试 |
| --- | --- | --- | --- |
| 1A P1-1 | 幂等 scope | `0005_*.sql`、`session.service.ts` | `idempotency-scope.test.ts` |
| 1B P1-3 | 解除关联 | `end-relationship.service.ts`、end route | `end-relationship.test.ts` |
| 1C P1-4 | Outbox | `0006_*.sql`、`append-outbox-event.ts` | `outbox-transaction.test.ts` |
| 2A R6 | 受控学生/改密 | `0007_*.sql`、`create-controlled-student.service.ts`、`change-password.service.ts` | `controlled-student.test.ts` + E2E |
| 2B R5 | Prettier | 全库格式化 | `pnpm format` |
| 3 P1-2 | 浏览器 UI | `src/app/**/page.tsx`、`components/ui/page-shell.tsx` | `m1-browser-flow.spec.ts` |
| — | Session epoch 刷新 | `refreshSessionCookieAfterEpochChange`（accept/end） | E2E accept/end 不再报 Session invalid |

## 4. 浏览器页面验证证据

### 4.1 Playwright UI E2E（主证据）

`tests/e2e/m1-browser-flow.spec.ts` 在 **desktop-chromium** 与 **mobile-360（360×800）** 各执行一次完整主路径，全部通过。覆盖：

1. 管理员 UI 生成邀请码  
2. 家长注册 + dev OTP 验证  
3. 家长创建受控学生  
4. 学生强制改密  
5. 关联码申请/接受  
6. reaction-v1 训练（点击）  
7. 刷新 + 重登读取结果  
8. 家长训练汇总  
9. 解除关联 → 页面 forbidden + API 403  

### 4.2 静态截图（补充证据）

路径：`.trellis/tasks/08-25-m1-verification-remediation/research/screenshots/`

| 文件 | 视口 | 页面 |
| --- | --- | --- |
| `desktop/01-home-logged-out.png` | 1280×720 | 首页（未登录） |
| `desktop/02-admin-invitations.png` | 1280×720 | 管理员邀请码 |
| `desktop/03-student-training-reaction.png` | 1280×720 | 学生反应力训练 |
| `mobile-360/01-home-logged-out.png` | 360×800 | 首页（未登录） |
| `mobile-360/02-student-training-reaction.png` | 360×800 | 学生训练 |
| `mobile-360/03-parent-training-summary.png` | 360×800 | 家长训练汇总（含 median 指标） |

桌面端家长汇总页由 E2E 断言 `parent-metric-median_reaction_ms` 可见性验证（与 mobile 截图同 API/UI 路径）。

捕获脚本：`tests/e2e/m1-evidence-capture.spec.ts`（验收专用，非 CI 门禁）。

## 5. 数据库迁移说明

按顺序应用（expand-only，不删历史 session 行）：

| 迁移 | 内容 |
| --- | --- |
| `0005_training_idempotency_scope.sql` | 移除全局 UNIQUE；添加 `(student_id, start/submit_idempotency_key)` partial unique |
| `0006_outbox_events.sql` | `outbox_events` 表 |
| `0007_controlled_student_password.sql` | `must_change_password`、`password_changed_at` |

```bash
pnpm db:migrate   # 或项目既有 migrate 命令
```

**注意**：0005–0007 的 Drizzle snapshot JSON 未入库（仅 journal + SQL）；生产迁移前建议在 staging 跑诊断 SQL（见 `design.md` §2.3）。

## 6. 已知风险与延期项

| 项 | 级别 | 说明 |
| --- | --- | --- |
| 管理员 TOTP 未实现 | **生产阻断** | 见 `research/m1-deferrals.md` §1 |
| Outbox Worker 未实现 | M3 | 事件保持 `pending` |
| 路径 B 学生自助注册 | 延期 | 见 deferrals §2 |
| accept/end 后 session cookie 刷新 | 已缓解 | API 返回新 cookie；客户端 fetch 自动更新 |
| E2E 默认端口 3002 | 低 | 避免与本地 dev 3000/3001 冲突 |
| Drizzle snapshot 缺失 0005–0007 | 低 | 以 SQL 迁移为准 |

## 7. 回归说明

- 原 M1 集成测试（identity、family-access、training、audit）全部保留并通过（53 项 vitest 含新增用例）。
- `training-flow.spec.ts` 中 `sessionKind` 断言已兼容同日第二次 completed 为 `practice`。

---

**验收结论**：P1-1～P1-4、P2-5、R6 路径 A 均已实现并通过自动化与浏览器 E2E 验收；R7 按 deferrals 文档延期。
