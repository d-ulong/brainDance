# P1 Implementation Record：统一密码规则与凭据交互

## Fixed handover

- Active task：`09-04-credential-training-access`
- Branch：`main`
- Directive SHA：`a6c77c20f728423cede2fe207e3b93e1bbcf9360`
- Implementation baseline：`70472aa0116287e55e8bb20a5487feaa706e31a8`
- Scope：P1 only（密码规则与密码输入体验；不含家长训练 / schema / migration / 积分 / 日程）

## Requirement mapping

| R / AC | Delivery |
|--------|----------|
| R-CTA-01 / AC-CTA-01 | `password-policy.ts` + `registration` / `create-controlled-student` / `change-password` 在哈希前调用 `assertProductPassword`；Route Zod 仅 `min(1).max(12)` 边界 |
| R-CTA-02 / AC-CTA-02 | `PasswordField`；确认密码仅前端校验；显示/隐藏含可读文本与 `aria-label`；覆盖注册 / 受控学生创建 / 学生改密 / 家长改密 |
| R-CTA-04（密码相关） | 聚焦集成测试 + `m1-browser-flow` desktop/mobile；DTO/Route/授权/不变量见下 |
| R-CTA-03 / AC-CTA-03 | **未实现**（家长训练，属后续阶段） |
| AC-CTA-04（迁移部分） | **未执行**（本阶段无 migration） |

## Key files

- Authority：`src/modules/identity/password-policy.ts`
- Services：`registration.service.ts`、`create-controlled-student.service.ts`、`change-password.service.ts`（家长+学生可改自身；管理员拒绝）
- Routes：`/api/auth/register`、`/api/family/students`、`/api/auth/change-password`（`requireAuthenticatedSession` + role gate）
- UI：`components/ui/password-field.tsx`；`register`、`student/change-password`、`parent/students/new`、`parent/change-password`；家长首页导航入口
- Tests：`tests/unit/identity/password-policy.test.ts`、`tests/integration/identity/*.test.ts`、`tests/e2e/m1-browser-flow.spec.ts`
- Fixtures：`tests/helpers/family-access.ts`、`scripts/e2e-bootstrap.ts`；经 `registerParent` 的测试家长密码改为合规 `Parent1aXy`

## Authorization / contracts preserved

- 改密仍校验当前密码、拒绝与当前相同、审计幂等、同事务推进 `authorizationEpoch`、失效旧会话并签发新 cookie
- `mustChangePassword` 写门禁未放宽；管理员无自助改密
- 确认密码不进入 API body

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm test -- tests/unit/identity/password-policy.test.ts tests/integration/identity/identity.test.ts tests/integration/identity/controlled-student.test.ts` | exit 0 — 3 files / 14 tests passed（Vitest 不支持 `--runInBand`；项目已 `fileParallelism: false`） |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — 0 errors（6 pre-existing warnings） |
| `pnpm format` | exit 0 — All matched files use Prettier |
| `git diff --check` | exit 0 — clean |
| `pnpm build` | exit 0 — Playwright `next start` 前置（指令未列，但定向 E2E 需要与本阶段 UI 一致的 `.next`） |
| `pnpm exec playwright test tests/e2e/m1-browser-flow.spec.ts --project=desktop-chromium --project=mobile-360 --workers=1` | exit 0 — 6 passed / 2 skipped（项目无 `chromium`；等价双视口） |

## Not executed

- 指令中的 `--runInBand`：Vitest 未知选项，已省略并说明
- 指令中的 `--project=chromium`：配置为 `desktop-chromium` / `mobile-360`
- 全量 test / 全量 E2E / Docker / `pnpm dev`：指令禁止
- 迁移命令：本阶段无 schema/migration 变更
- P2/P3 / 家长训练：范围外

## Risks / open review items

- 经 `registerParent` 的历史超长测试密码已改为 `Parent1aXy`；直接 `hashPassword` 种子的旧长密码路径保留（登录不受新规则阻止）
- 家长改密成功后清空表单字段；服务端拒绝时保留已输入值
