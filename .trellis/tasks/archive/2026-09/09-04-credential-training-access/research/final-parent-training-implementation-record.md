# Final Implementation Record：家长训练中心与验收

## Fixed handover

- Active task：`09-04-credential-training-access`
- Branch：`main`
- Directive SHA：`7a4baf315d65af89e506adea41a1fc9a51c88ce1`
- Implementation baseline：`cf79f2e`
- Remediation baseline：`7e2782cee46473550f5452266d26b90ddf60b7fe`
- Scope：最终交付 + 唯一集中整改（联系方式门禁、成人 summary 默认 ageBand、E2E helper 文本恢复）

## Requirement mapping

| R / AC / 边界 | Delivery |
|---------------|----------|
| R-CTA-03 / AC-CTA-03 | `/parent/training` 与 `/parent/training/[sessionId]`；复用 runner；结果与趋势仅本人 |
| 生命周期参数化 | `useTrainingSessionLifecycle(key, { role, hubPath, resultPathPrefix })`；学生/家长路径分离 |
| Runner 复用 | `Reaction/Stroop/DigitSpanTrainingRunner`；学生与家长页仅注入 lifecycle options |
| Self-only API | `GET /api/training/summary`、`GET /api/training/trends`：仅当前认证 user；DTO 用 `traineeId`；不接受 owner/student ID |
| Parent contact gate | `requireTraineeSession` 对 parent 实时要求 `contactVerifiedAt`；覆盖 start/event/submit/terminate/session read/summary/trends；student must-change-password 不变 |
| Adult empty summary | `getTrainingSummaryForSubject` 无 session/projection 时使用经 authority 校验的 `subject.ageBand`（parent=`adult`） |
| TrendsPanel | `mode: "self" \| "student"`；家长自己结果走 self；家长查看学生仍走 family trends |
| 家长首页导航 | `/` ParentHome 增加 `parent-training-nav` |
| 成人说明 | 无儿童年龄档/比较；无积分/日程/推送入口；结果 `ageBand=adult` |
| AC-CTA-04 | 聚焦 API 隔离测试 + desktop/mobile E2E；保留运行 P1/P2 聚焦回归 |

## Key files

- Guard：`src/lib/auth-request.ts`（`requireTraineeSession` parent `contactVerifiedAt`）
- Service：`session.service.ts`（`getTrainingSummaryForSubject` 默认 `subject.ageBand`）
- UI：`src/app/parent/training/**`、`src/app/page.tsx`、`src/components/training/*-training-runner.tsx`、`use-training-session-lifecycle.ts`、`trends-panel.tsx`
- Client：`src/lib/client/training-api.ts`（`PARENT_TRAINING_OPTIONS`、`fetchOwnTraining*`）
- API：`src/app/api/training/summary/route.ts`、`src/app/api/training/trends/route.ts`
- Tests：`tests/integration/api/parent-training-self-routes.test.ts`、`tests/e2e/parent-training-flow.spec.ts`、`tests/e2e/m5-training-helpers.ts`
- Record：本文件

## Acceptance matrix

| 验收项 | 证据 |
|--------|------|
| desktop/mobile：登录→训练中心→完成→结果；URL 始终 `/parent/training*`；adult；无学生 ID/积分日程入口 | `parent-training-flow.spec.ts` |
| 家长 self summary/trends 仅自身 traineeId；他家长/学生不可读该 session | `parent-training-self-routes.test.ts` |
| 未验证 parent 被 trainee routes 拒绝；已验证 parent 正常；空 summary=`adult` | `parent-training-self-routes.test.ts` contact gate 用例 |
| P2 主体隔离未削弱 | `p2-training-subject-routes.test.ts` |
| m5 helper：保留 reaction hubBase/ASCII；恢复 Stroop/数字广度 `次`/`第 … 次`/`—` | `m5-training-helpers.ts` + `m5-training-flow.spec.ts` |
| `git diff --check` | exit 0 |

## Verification command log

| Command | Result |
|---------|--------|
| `pnpm test -- tests/integration/api/parent-training-self-routes.test.ts tests/integration/api/p2-training-subject-routes.test.ts` | exit 0 — 2 files / 4 tests passed |
| `pnpm exec playwright test tests/e2e/parent-training-flow.spec.ts tests/e2e/m5-training-flow.spec.ts --project=desktop-chromium --workers=1` | exit 0 — 12 passed（含 m5 + parent） |
| `git diff --check` | exit 0 |

## Not executed

- 全量 test / 全量 E2E / Docker 业务开发服务 / `pnpm dev`：指令禁止（验证前仅拉起本机 postgres 以满足 DB 集成与 E2E）
- migration/schema、P2 authority/事务核心、密码功能、积分/日程/关系/推送/worker：范围外未改

## Risks

- 学生结果页趋势改走 `/api/training/trends`（self）；家庭授权下的家长查看学生路径未改
- 旧 `studentId` 字段仍保留在家庭 trends/summary DTO，仅 self API 使用 `traineeId`
- `completeReactionTraining` 进度断言保留 ASCII 正则；Stroop/数字广度恢复中文与 em dash
