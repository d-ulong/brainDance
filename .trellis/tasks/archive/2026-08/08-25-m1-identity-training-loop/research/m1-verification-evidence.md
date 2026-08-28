# M1 质量审查证据（2026-08-25）

## 自动化验证（本地）

| 命令 | 结果 |
| --- | --- |
| `pnpm db:migrate` | 0001–0004 迁移成功 |
| `pnpm test` | 32/32 通过（含 audit/family/training/identity 集成） |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm build` | 通过 |
| `pnpm test:e2e` | 3/3 通过（含 AC-3 训练刷新与家长汇总） |

## AC 对照（代码 + 测试）

| AC | 实现要点 | 测试 |
| --- | --- | --- |
| AC-1 未确认不可访问 | `requireActiveRelationship`；pending 时 profile + training-summary 403 | `family-access.test.ts` |
| AC-2 关联码不可复用 | hash 入库、消费后拒绝、过期拒绝 | `family-access.test.ts` |
| AC-3 训练刷新可读 | 服务端计分持久化；GET session | `training.test.ts` + `training-flow.spec.ts` |
| AC-4 邀请码约束 | 角色/过期/撤销/次数 | `identity.test.ts` |
| AC-5 家长验证门禁 | `requireVerifiedParent` | `family-access.test.ts` |
| AC-6 授权纪元 | session.epoch 与 user.epoch 校验；accept 递增 | `family-access.test.ts` + `login.service.ts` |
| AC-7 审计 | append-only；无明文 secrets | `audit-coverage.test.ts` + identity/family 断言 |

## 与 CONTEXT / data-model 对齐项

- `relationships.status=active` 为授权事实源（非 membership 投影）
- 关联码 10 分钟、一次性、hash 存储
- 反应力：中位反应时 + 准确率；100–3000ms 异常剔除（`reaction-v1`）
- 每日 effective 训练：部分唯一索引 + advisory lock
- 首位家长 accept 写入 `guardian_consents`（`policy-v0.1-m1`）
- `family_date` / 年龄档：`Asia/Shanghai` Time Policy

## 已知未实现（M1 范围外或延后）

- outbox_events / Worker（design 占位，M3）
- 解除关联、多家长、训练 UI 页面
- Stroop / 数字广度 / 趋势 / 计划 / 积分
- 管理员 TOTP、路径 B 学生自助注册 E2E
- Playwright AC-1 HTTP 专项用例（集成层已覆盖）

## M2 建议

1. Schedule & Facts：计划版本、`occurrence_key`、Time Policy 截止
2. 训练 UI + 360px 主路径页面（注册/关联/训练）
3. outbox 表与同步 no-op 处理器
4. CI 增加 `SKIP_DB_TESTS=false` 显式断言
