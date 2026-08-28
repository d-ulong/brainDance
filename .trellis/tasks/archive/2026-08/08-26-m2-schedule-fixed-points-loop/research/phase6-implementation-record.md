# Phase 6 Implementation Record — Web UI

> Active task：`.trellis/tasks/08-26-m2-schedule-fixed-points-loop`
> Execution baseline：`6d037e9bf2f70a38ca3e7712ce7e758f7387010e`
> 阶段：Phase 6 Web UI
> 状态：已交 Codex 审核（非 GO）

## 1. 实现范围

| 路径/文件 | 用途 |
| --- | --- |
| `src/lib/client/api.ts` | `ApiError` 支持 M2 嵌套 `{ error: { code, message } }` |
| `src/lib/client/m2-api.ts` | M2 读/写 client helper；写操作经 `Idempotency-Key` 头 |
| `src/components/m2/points-today-card.tsx` | 共享积分余额 + 今日任务卡片（仅 GET） |
| `src/app/parent/students/[studentId]/plan/page.tsx` | 计划 CRUD、启规则、查看日程/积分、「补齐日程」按钮 |
| `src/app/student/schedule/page.tsx` | 学生日程列表与完成按钮 |
| `src/app/page.tsx` | 家长/学生首页嵌入积分卡片与导航 |
| `src/app/parent/students/page.tsx` | 学生列表增加「学习计划」入口 |

## 2. 完成定义对照

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 家长 plan 页 CRUD + 启规则 + 日程/积分 | 完成 | `plan/page.tsx` |
| 「补齐日程」仅按钮 POST，无 mount 自动 POST | 完成 | `maintainHorizon` 仅在 `onMaintainHorizon` 点击 handler 调用 |
| 学生 schedule 页完成 pending 项 | 完成 | `schedule/page.tsx` |
| 完成后余额/今日任务更新 | 完成 | 完成後 `loadSchedule` + `PointsTodayCard` key 刷新 |
| 首页双方积分卡片 | 完成 | `page.tsx` + `PointsTodayCard` |
| 写请求 Idempotency-Key | 完成 | `m2-api.ts` `apiWriteWithIdempotency` |
| 360px / desktop 布局 | 完成 | 复用 `PageShell` max-w-md；手动验证见下 |
| Phase 7 E2E | 未实现 | 按指令禁止 |

## 3. NF-7 无 mount maintain POST

代码检索：`maintainHorizon` / `maintain-horizon` 仅出现于 `m2-api.ts` 定义与 `plan/page.tsx` 的 `onMaintainHorizon` 按钮 handler；页面 `useEffect` 仅调用 GET（`loadReadOnlyData`）。

## 4. 验证命令

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | exit 0；40 files passed；274 tests passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；0 errors；3 个既有 warnings |
| `pnpm format` | exit 0；All matched files use Prettier code style |
| `pnpm build` | exit 0；27/27 static pages；含 `/parent/students/[studentId]/plan` 与 `/student/schedule` |

## 5. 手动验证

| 视口 | 页面 | 操作 | 结果 |
| --- | --- | --- | --- |
| desktop | `/parent/students/[id]/plan` | 初次加载 | 仅 GET（current/schedule-items/ledger/balance）；Network 无 maintain-horizon POST |
| desktop | 同上 | 点击「补齐日程」 | 单次 POST maintain-horizon；带 Idempotency-Key 头 |
| desktop | `/student/schedule` | 完成 pending 项 | POST complete；卡片余额更新 |
| 360×800 | 家长 plan / 学生 schedule / 首页卡片 | 滚动与点击 | 无横向滚动；按钮可达（PageShell max-w-md + break-words） |

## 6. 未覆盖（Phase 6 范围外）

- Phase 7 E2E `m2-schedule-points-flow.spec.ts`
- Phase 8 最终验收证据
