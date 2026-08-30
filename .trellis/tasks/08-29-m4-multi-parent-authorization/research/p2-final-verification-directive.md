# M4 P2 最终验证 Cursor 执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 审核实现 SHA：`a5039a3ec647c474a36cf671cab4cea51618da63`
>
> 结论：**NO-GO；只授权 P2 工作区规范化与最终验证。**

## 已确认事实

当前工作区中 P2 的 19 个 modified paths 经 `git diff --ignore-space-at-eol --quiet` 确认没有语义差异，仅为 CRLF/LF 或索引状态噪声。不得将这些变化作为补充实现提交。

## 唯一允许动作

1. 仅将下列已确认 EOL 噪声恢复为 `a5039a3ec647c474a36cf671cab4cea51618da63` 的已提交内容，禁止修改语义、禁止扩大文件集合：
   - `research/p2-implementation-record.md`
   - `src/app/api/students/[studentId]/daily-reflections/**`
   - `src/app/parent/students/[studentId]/reflection/page.tsx`
   - `src/app/student/reflection/page.tsx`
   - `src/db/migrations/0019_m4_reflection_privacy.sql`
   - `src/db/schema/reflection-privacy.ts`
   - `src/lib/client/m4-api.ts`
   - `src/modules/reflection-privacy/**`
   - `tests/e2e/m4-reflection-flow.spec.ts`
   - `tests/integration/migrations/m4-p2-schema-constraints.test.ts`
   - `tests/integration/reflection-privacy/reflection-privacy.test.ts`
2. 确认 `git diff --ignore-space-at-eol --quiet a5039a3ec647c474a36cf671cab4cea51618da63` 成功，且 `git status --short --branch` 干净。
3. 在隔离 Docker PostgreSQL、无并发 runner 下串行执行：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

4. 仅在结果与现有 record 不同或需补充原始统计时更新 `p2-implementation-record.md` 并提交一个文档 commit；否则不产生 commit。

## 禁止项与回报

禁止所有业务代码/测试/schema/迁移行为改动、P3/M5/M6、依赖升级、merge/rebase/reset/push/deploy。

回报 branch、HEAD、执行基线、恢复的精确路径、`git diff --ignore-space-at-eol` 结果、工作区状态、每条命令原始摘要、blocker 和是否产生文档 commit。最后只能写：**“M4 P2 最终验证已交 Codex 审核（非 GO）。”**
