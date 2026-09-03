# M7 AC-M7-09 里程碑门禁唯一指令

## 固定交接

- Active task：`.trellis/tasks/09-02-m7-family-push-pilot`
- 分支：`feat/m7-family-push-pilot`
- 执行基线：由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 范围：只验证 AC-M7-09；不修改业务代码、规格、任务状态或签署，不创建提交。

开始前核对分支、HEAD、基线和干净工作区。不 pull/fetch、切分支、建 worktree、merge、rebase、reset、push、部署、安装/升级依赖或操作生产/用户数据库。

## 一次性验证序列

按以下顺序，每项最多运行一次。任意一项失败、超时或无最终结果时立即停止，保留输出并回报 blocker；不得重跑、调参、修环境或继续后续命令。

1. `pnpm db:migrate`
2. `pnpm test`
3. `pnpm typecheck`
4. `pnpm lint`
5. `pnpm format`
6. `pnpm build`
7. `pnpm exec playwright test tests/e2e/m7-family-push-flow.spec.ts tests/e2e/m7-family-push-media.spec.ts --project=desktop-chromium --project=mobile-360 --workers=1`
8. `git diff --check <baseline>...HEAD`

`db:migrate` 仅允许连接当前已配置的非生产开发/测试数据库；若环境无法证明这一点，停止并报告。E2E 必须串行，覆盖文本/链接与媒体的 desktop/mobile；build 只作为 E2E prerequisite 与 AC-M7-09 质量门证据。

## 回报

只回报：完整 baseline/HEAD、每条命令的退出码与摘要、首个 blocker（若有）、未运行项、工作区状态。结尾写“已交 M7 里程碑门禁审核”。不得自行 GO、签署、merge 或 push。

