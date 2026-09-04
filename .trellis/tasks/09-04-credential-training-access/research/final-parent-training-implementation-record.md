# Final Implementation Record：家长训练中心与验收

## Fixed handover

- Active task：`09-04-credential-training-access`
- Branch：`main`
- Directive SHA：`7a4baf315d65af89e506adea41a1fc9a51c88ce1`
- Implementation baseline：`cf79f2e`
- Scope：最终交付（家长训练 UI、self-only summary/trends、双视口 E2E、P1/P2 回归）

## Requirement mapping

| R / AC / 边界 | Delivery |
|---------------|----------|
| R-CTA-03 / AC-CTA-03 | `/parent/training` 与 `/parent/training/[sessionId]`；复用 runner；结果与趋势仅本人 |
| 生命周期参数化 | `useTrainingSessionLifecycle(key, { role, hubPath, resultPathPrefix })`；学生/家长路径分离 |
| Runner 复用 | `Reaction/Stroop/DigitSpanTrainingRunner`；学生与家长页仅注入 lifecycle options |
| Self-only API | `GET /api/training/summary`、`GET /api/training/trends`：仅当前认证 user；DTO 用 `traineeId`；不接受 owner/student ID |
| TrendsPanel | `mode: "self" \| "student"`；家长自己结果走 self；家长查看学生仍走 family trends |
| 家长首页导航 | `/` ParentHome 增加 `parent-training-nav` |
| 成人说明 | 无儿童年龄档/比较；无积分/日程/推送入口；结果 `ageBand=adult` |
| AC-CTA-04 | 聚焦 API 隔离测试 + desktop/mobile E2E；保留运行 P1/P2 聚焦回归 |

## Key files

- UI：`src/app/parent/training/**`、`src/app/page.tsx`、`src/components/training/*-training-runner.tsx`、`use-training-session-lifecycle.ts`、`trends-panel.tsx`
- Client：`src/lib/client/training-api.ts`（`PARENT_TRAINING_OPTIONS`、`fetchOwnTraining*`）
- API：`src/app/api/training/summary/route.ts`、`src/app/api/training/trends/route.ts`
- Service：`session.service.ts`（`getTrainingSummaryForSubject`、`getOwnTrainingTrendsForSubject`）
- Tests：`tests/integration/api/parent-training-self-routes.test.ts`、`tests/e2e/parent-training-flow.spec.ts`、`tests/e2e/m5-training-helpers.ts`
- Record：本文件

## Acceptance matrix

| 验收项 | 证据 |
|--------|------|
| desktop/mobile：登录→训练中心→完成→结果；URL 始终 `/parent/training*`；adult；无学生 ID/积分日程入口 | `parent-training-flow.spec.ts` × desktop-chromium + mobile-360 — 2 passed |
| 家长 self summary/trends 仅自身 traineeId；他家长/学生不可读该 session | `parent-training-self-routes.test.ts` |
| P2 迁移/主体隔离未削弱 | 重跑 P2 三文件 — passed |
| P1 密码三文件回归 | password-policy + identity + controlled-student — passed |
| typecheck / lint / format(touched) / diff --check | exit 0（lint 仅既有 warnings） |

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/api/parent-training-self-routes.test.ts tests/integration/migrations/p2-training-trainee-id.test.ts tests/integration/training/p2-training-subject.test.ts tests/integration/api/p2-training-subject-routes.test.ts tests/unit/identity/password-policy.test.ts tests/integration/identity/identity.test.ts tests/integration/identity/controlled-student.test.ts` | exit 0 — 7 files / 24 tests passed |
| `pnpm typecheck` | exit 0（曾对 P2 migration 测试做 `unknown` 中转 cast，解除既有 TS2352） |
| `pnpm lint` | exit 0 — 0 errors（6 pre-existing warnings） |
| `pnpm exec prettier --check`（交付触及路径） | exit 0 |
| `git diff --check` | exit 0 |
| `pnpm build` | exit 0 — Playwright `next start` 前置 |
| `pnpm exec playwright test tests/e2e/parent-training-flow.spec.ts --project=desktop-chromium --project=mobile-360 --workers=1` | exit 0 — 2 passed |

## Not executed

- 全量 `pnpm format`：仓库另有既有未触及文件格式告警（如 `p2-training-subject.test.ts`）；交付触及路径已 prettier-check 通过
- 全量 test / 全量 E2E / Docker / `pnpm dev`：指令禁止
- migration/schema、P2 authority/事务核心、密码功能、积分/日程/关系/推送/worker：范围外未改业务语义

## Risks

- 学生结果页趋势改走 `/api/training/trends`（self）；家庭授权下的家长查看学生路径未改
- 旧 `studentId` 字段仍保留在家庭 trends/summary DTO，仅 self API 使用 `traineeId`
- `completeReactionTraining` 进度断言改为 ASCII 正则，避免 Windows 下中文测试串编码损坏
