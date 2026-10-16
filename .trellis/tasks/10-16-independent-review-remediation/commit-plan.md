# 提交计划（待一次确认）

基线 main / 3d4c47637fb48b3f985674050342c0b73d30741c。

## 1. fix: complete independent review remediation

一次聚焦提交：授权与身份、日程更正及计分、生命周期和训练、界面恢复/导航、配套迁移、测试、规格与证据。

`playwright.config.ts` 为混合修改：只提交本次 TOTP fixture import/配置、ADMIN_TOTP_SECRETS 和测试服务 start→dev 增量；原有 outputDir 与媒体/导出目录增量留在工作区。不得整文件暂存。

文件清单：

- `.github/workflows/ci.yml`
- `.gitignore`
- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/review-remediation-contracts.md`
- `.trellis/spec/backend/schedule-execution-contracts.md`
- `.trellis/tasks/10-16-independent-review-remediation/.gitignore`
- `.trellis/tasks/10-16-independent-review-remediation/browser-check.cjs`
- `.trellis/tasks/10-16-independent-review-remediation/browser.config.ts`
- `.trellis/tasks/10-16-independent-review-remediation/check.jsonl`
- `.trellis/tasks/10-16-independent-review-remediation/commit-plan.md`
- `.trellis/tasks/10-16-independent-review-remediation/design.md`
- `.trellis/tasks/10-16-independent-review-remediation/evidence/browser-results.json`
- `.trellis/tasks/10-16-independent-review-remediation/evidence/integration-results.json`
- `.trellis/tasks/10-16-independent-review-remediation/evidence/parent-self-redemption-360.png`
- `.trellis/tasks/10-16-independent-review-remediation/evidence/schedule-candy-1280.png`
- `.trellis/tasks/10-16-independent-review-remediation/evidence/schedule-candy-360.png`
- `.trellis/tasks/10-16-independent-review-remediation/evidence/schedule-space-1280.png`
- `.trellis/tasks/10-16-independent-review-remediation/evidence/schedule-space-360.png`
- `.trellis/tasks/10-16-independent-review-remediation/implement.jsonl`
- `.trellis/tasks/10-16-independent-review-remediation/implement.md`
- `.trellis/tasks/10-16-independent-review-remediation/prd.md`
- `.trellis/tasks/10-16-independent-review-remediation/task.json`
- `CONTEXT.md`
- `docs/identity-security-configuration.md`
- `docs/independent-review-2026-10-16.md`
- `docs/independent-review-remediation-2026-10-16.md`
- `docs/product-scope.md`
- `docs/requirements.md`
- `eslint.config.mjs`
- `lessons.md`
- `memo.md`
- `playwright.config.ts`
- `scripts/e2e-bootstrap.ts`
- `scripts/lifecycle-worker.mts`
- `scripts/run-e2e.mts`
- `src/app/account/page.tsx`
- `src/app/admin/invitations/page.tsx`
- `src/app/api/auth/login/route.ts`
- `src/app/api/family/students/[studentId]/points/balance/route.ts`
- `src/app/api/family/students/[studentId]/points/ledger/route.ts`
- `src/app/api/family/students/[studentId]/redemption-catalog/route.ts`
- `src/app/api/family/students/[studentId]/redemptions/route.ts`
- `src/app/api/family/students/[studentId]/schedule-items/route.ts`
- `src/app/api/family/students/[studentId]/training/sessions/[sessionId]/route.ts`
- `src/app/api/schedule-items/[itemId]/correct/route.ts`
- `src/app/api/schedule-items/[itemId]/execution/route.ts`
- `src/app/globals.css`
- `src/app/login/page.tsx`
- `src/app/page.tsx`
- `src/app/parent/change-password/page.tsx`
- `src/app/parent/goals/page.tsx`
- `src/app/parent/link/page.tsx`
- `src/app/parent/my-redemption/page.tsx`
- `src/app/parent/plans/[planId]/edit/page.tsx`
- `src/app/parent/plans/new/page.tsx`
- `src/app/parent/plans/page.tsx`
- `src/app/parent/pushes/page.tsx`
- `src/app/parent/redemption/page.tsx`
- `src/app/parent/schedule/page.tsx`
- `src/app/parent/students/[studentId]/export/page.tsx`
- `src/app/parent/students/[studentId]/plan/page.tsx`
- `src/app/parent/students/[studentId]/redemption/page.tsx`
- `src/app/parent/students/[studentId]/reflection/page.tsx`
- `src/app/parent/students/[studentId]/schedule/page.tsx`
- `src/app/parent/students/[studentId]/training/[sessionId]/page.tsx`
- `src/app/parent/students/[studentId]/training/page.tsx`
- `src/app/parent/students/new/page.tsx`
- `src/app/parent/students/page.tsx`
- `src/app/parent/training/[sessionId]/page.tsx`
- `src/app/parent/training/page.tsx`
- `src/app/register/page.tsx`
- `src/app/student/account-deletion/page.tsx`
- `src/app/student/change-password/page.tsx`
- `src/app/student/export/page.tsx`
- `src/app/student/link/page.tsx`
- `src/app/student/plans/[planId]/edit/page.tsx`
- `src/app/student/plans/new/page.tsx`
- `src/app/student/plans/page.tsx`
- `src/app/student/pushes/[pushId]/page.tsx`
- `src/app/student/pushes/page.tsx`
- `src/app/student/redemption/page.tsx`
- `src/app/student/reflection/page.tsx`
- `src/app/student/training/[sessionId]/page.tsx`
- `src/app/student/training/page.tsx`
- `src/app/verify-contact/page.tsx`
- `src/components/home/parent-home-dashboard.tsx`
- `src/components/home/student-home-dashboard.tsx`
- `src/components/schedule/schedule-calendar.tsx`
- `src/components/schedule/student-schedule-workspace.tsx`
- `src/components/training/digit-span-training-runner.tsx`
- `src/components/training/reaction-training-runner.tsx`
- `src/components/training/stroop-training-runner.tsx`
- `src/components/training/use-training-session-lifecycle.ts`
- `src/components/ui/page-shell.tsx`
- `src/components/ui/top-tabs.tsx`
- `src/db/migrations/0048_schedule_execution_revisions.sql`
- `src/db/migrations/0049_identity_assurance.sql`
- `src/db/migrations/0050_lifecycle_signed_reversals.sql`
- `src/db/migrations/0051_points_safe_integer_capacity.sql`
- `src/db/migrations/meta/_journal.json`
- `src/db/schema/identity.ts`
- `src/db/schema/plan-library.ts`
- `src/db/schema/points.ts`
- `src/lib/auth-request.ts`
- `src/lib/client/api.ts`
- `src/lib/client/m2-api.ts`
- `src/lib/http-errors.ts`
- `src/lib/lucia.ts`
- `src/lib/schedule/execution-timer.ts`
- `src/lib/schedule/home-schedule.ts`
- `src/modules/data-lifecycle/deletion-request.service.ts`
- `src/modules/data-lifecycle/due-work.service.ts`
- `src/modules/data-lifecycle/export-job.service.ts`
- `src/modules/data-lifecycle/m6-outbox-handlers.ts`
- `src/modules/data-lifecycle/module-data-manifest.ts`
- `src/modules/data-lifecycle/subject-access.service.ts`
- `src/modules/data-lifecycle/tombstone-replay.service.ts`
- `src/modules/facts/confirm-fact.service.ts`
- `src/modules/facts/correct-fact.service.ts`
- `src/modules/facts/submit-error-count.service.ts`
- `src/modules/family-access/end-relationship.service.ts`
- `src/modules/family-access/linked-students.service.ts`
- `src/modules/family-content/access.ts`
- `src/modules/family-content/answer.service.ts`
- `src/modules/family-content/comment.service.ts`
- `src/modules/family-content/create-push.service.ts`
- `src/modules/family-content/m7-outbox-handlers.ts`
- `src/modules/family-content/media-purge.service.ts`
- `src/modules/family-content/media-scanner.ts`
- `src/modules/family-content/media-upload.service.ts`
- `src/modules/family-content/push-lifecycle.service.ts`
- `src/modules/goals/goal.service.ts`
- `src/modules/identity/account-deletion.service.ts`
- `src/modules/identity/errors.ts`
- `src/modules/identity/login.service.ts`
- `src/modules/identity/totp.ts`
- `src/modules/identity/trusted-client-ip.ts`
- `src/modules/identity/verification-delivery.ts`
- `src/modules/identity/verification.service.ts`
- `src/modules/outbox/event-registry.ts`
- `src/modules/outbox/worker-constants.ts`
- `src/modules/projection/rebuild-projection.service.ts`
- `src/modules/redemption/catalog.service.ts`
- `src/modules/redemption/ledger-redemption.service.ts`
- `src/modules/redemption/redemption.service.ts`
- `src/modules/reflection-privacy/delete-daily-reflection.service.ts`
- `src/modules/reflection-privacy/get-daily-reflection.service.ts`
- `src/modules/reflection-privacy/grant-private-access.service.ts`
- `src/modules/reflection-privacy/upsert-daily-reflection.service.ts`
- `src/modules/schedule/clear-schedule.service.ts`
- `src/modules/schedule/complete-schedule.service.ts`
- `src/modules/schedule/effective-status.ts`
- `src/modules/schedule/execution-input-schema.ts`
- `src/modules/schedule/execution-state.ts`
- `src/modules/schedule/maintain-horizon.service.ts`
- `src/modules/schedule/persist-expired.service.ts`
- `src/modules/schedule/plan-library.service.ts`
- `src/modules/schedule/plan.service.ts`
- `src/modules/schedule/reconcile-schedule-priority.service.ts`
- `src/modules/schedule/schedule-query.service.ts`
- `src/modules/schedule/skip-schedule.service.ts`
- `src/modules/schedule/start-plan-item.service.ts`
- `src/modules/schedule/task-execution.service.ts`
- `src/modules/settlement/error-count-settlement.service.ts`
- `src/modules/settlement/ledger-order.ts`
- `src/modules/settlement/ledger.service.ts`
- `src/modules/settlement/manual-points.service.ts`
- `src/modules/settlement/point-rule.service.ts`
- `src/modules/settlement/settlement.service.ts`
- `src/modules/time-policy/completion-window.ts`
- `src/modules/time-policy/plan-settlement-deadline.ts`
- `src/modules/time-policy/resolve-age-band.ts`
- `src/modules/training/session.service.ts`
- `src/modules/training/trends.service.ts`
- `tests/e2e/m5-training-helpers.ts`
- `tests/e2e/session-recovery.spec.ts`
- `tests/e2e/ui-goals-training-polish-helpers.ts`
- `tests/e2e/ui-helpers.ts`
- `tests/helpers/e2e-auth-config.ts`
- `tests/helpers/identity.ts`
- `tests/helpers/training-submit-race.ts`
- `tests/helpers/training.ts`
- `tests/integration/data-lifecycle/deletion-lifecycle.test.ts`
- `tests/integration/data-lifecycle/e01-tombstone-artifact-purge.test.ts`
- `tests/integration/data-lifecycle/p2-remediation.test.ts`
- `tests/integration/data-lifecycle/review-remediation.test.ts`
- `tests/integration/facts/facts-flow.test.ts`
- `tests/integration/family-content/family-media.test.ts`
- `tests/integration/goals/goal-complete.test.ts`
- `tests/integration/goals/goal-horizon-and-gift-redemption.test.ts`
- `tests/integration/identity/account-experience.test.ts`
- `tests/integration/identity/identity.test.ts`
- `tests/integration/identity/review-remediation.test.ts`
- `tests/integration/projection/rebuild-projection.test.ts`
- `tests/integration/projection/rebuild-training-projection.test.ts`
- `tests/integration/redemption/redemption-lifecycle.test.ts`
- `tests/integration/schedule/persist-expired.test.ts`
- `tests/integration/schedule/plan-library.test.ts`
- `tests/integration/schedule/review-remediation.test.ts`
- `tests/integration/settlement/goals-and-manual-penalties.test.ts`
- `tests/integration/training/m5-concurrency.test.ts`
- `tests/integration/training/m5-trends.test.ts`
- `tests/integration/training/p2-training-subject.test.ts`
- `tests/integration/training/training-session-review-matrix.test.ts`
- `tests/integration/training/training.test.ts`
- `tests/unit/client/parent-points-routes.test.ts`
- `tests/unit/client/session-cache.test.ts`
- `tests/unit/data-lifecycle/body-redaction.test.ts`
- `tests/unit/identity/security-controls.test.ts`
- `tests/unit/outbox/event-coverage.test.ts`
- `tests/unit/schedule/effective-status.test.ts`
- `tests/unit/schedule/execution-state.test.ts`
- `tests/unit/schedule/execution-timer.test.ts`
- `tests/unit/schedule/home-schedule.test.ts`
- `tests/unit/schedule/schedule-calendar.test.ts`
- `tests/unit/time-policy/completion-window.test.ts`
- `tests/unit/time-policy/family-local-instant.test.ts`
- `vitest.unit.config.ts`

- `.trellis/tasks/10-16-independent-review-remediation/evidence/reviewed-source-sha256.json`

- `.trellis/tasks/10-16-independent-review-remediation/implementation.md`

- `.trellis/spec/frontend/quality-guidelines.md`

- `tests/e2e/public-entry-theme.spec.ts`

- `.trellis/tasks/10-16-independent-review-remediation/evidence/public-entry-results.json`

- `.trellis/tasks/10-16-independent-review-remediation/evidence/public-home-candy-1280.png`

- `.trellis/tasks/10-16-independent-review-remediation/evidence/public-home-candy-360.png`

- `.trellis/tasks/10-16-independent-review-remediation/evidence/public-home-space-1280.png`

- `.trellis/tasks/10-16-independent-review-remediation/evidence/public-home-space-360.png`

## 排除的原有修改

- `tests/setup.ts`
- `vitest.config.ts`
- `playwright.config.ts` 的原有产物路径修改（上述部分暂存保留）
- `.claude/`、`.idea/`、`.dockerignore`、`Dockerfile.local`、`compose.local.yaml`、`docs/docker-local.md`

运行缓存、原始日志不提交。确认后先核对 HEAD/工作区与本清单，再暂存精确范围、核对 staged diff、提交；不推送。之后按 Trellis 规范归档本任务并记录会话。


2026-10-17：用户明确授权“提交并推送”。两轮变更存在源码/规格依赖，合并为 `fix: complete review remediation and admin account recovery`；排除原有无关修改和私有运行文件。业务提交后仅归档这两个关联任务并记录日志，普通推送 origin/main。
