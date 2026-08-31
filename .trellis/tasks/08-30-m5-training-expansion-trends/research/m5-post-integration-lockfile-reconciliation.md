# M5 归并后锁文件前向纠偏指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`fix/m5-lockfile-reconciliation`
>
> 已同步 `main` / `origin/main`：`0d9f240a9991e48cb3da892ed25e56ec3a7ea6d6`
>
> 锁文件干净基线：`680673198c1e0730d9a5add0594a96416a55b063`
>
> 性质：**产品规格保持 GO；只做已推送历史上的前向仓库状态纠偏。**

## 唯一问题 M5-L01

`package.json` 与 `vitest.config.ts` 已恢复，但 `pnpm-lock.yaml` 相对干净基线仍残留 `happy-dom@20.12.0`、`@types/whatwg-mimetype`、`@types/ws`、`buffer-image-size`、`entities`、`whatwg-mimetype`、`ws@8.21.3` 以及 Vitest 的 `happy-dom` peer 解析，共 73 行新增。它违反 P3-R06-S1“撤销本阶段对 `pnpm-lock.yaml` 的新增依赖变更”，也使现有签署的“锁文件扩张已移除”证据不准确。

## 授权动作

1. 仅将 `pnpm-lock.yaml` 恢复为 SHA `680673198c1e0730d9a5add0594a96416a55b063` 中的版本；不得改动 `package.json`、生产代码、测试、任务规格或签署文件。
2. 使用冻结锁文件安装校验，证明当前 `package.json` 与恢复后的 lockfile 一致；禁止执行会重新生成或升级锁文件的普通安装。
3. 验证完成后只提交一个聚焦 commit，不 push、不归并。

## 完成定义

```bash
git diff --exit-code 680673198c1e0730d9a5add0594a96416a55b063 -- pnpm-lock.yaml
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

所有命令必须退出 0；`git diff --stat <执行基线>..HEAD` 必须只列出 `pnpm-lock.yaml`。

## 回报格式

```text
branch: fix/m5-lockfile-reconciliation
HEAD: <完整 SHA>
execution_base: <包含本指令的完整 SHA>
status: M5-L01 锁文件前向纠偏已交 Codex 复验（未归并、未推送）
changed_files:
- pnpm-lock.yaml
verification_raw_summary:
- <命令>: <退出码与原始摘要>
blockers:
- <无则写 none>
```

最后一句必须是：**“M5-L01 已交 Codex 复验，未归并、未推送、未启动 M6。”**
