# M4 P1 数据库验证 Cursor 执行指令

> Active task: `.trellis/tasks/08-29-m4-multi-parent-authorization`
>
> 审核实现 SHA：`1caf23f941c65dcfa2f514219969b8feac8da183`
>
> 结论：**NO-GO；只授权 P1 数据库与 E2E 验证。**

## 唯一前置条件

启动本机 Docker Desktop/PostgreSQL，确认 `DATABASE_URL` 指向隔离测试库且没有并发 test runner。不得使用生产或共享业务库。

## 唯一允许动作

不修改任何业务代码、schema、迁移、测试、配置或既有规划/整改文档。数据库可用后，串行执行：

```bash
pnpm db:migrate
pnpm test
pnpm test:e2e
```

仅更新 `research/p1-implementation-record.md` 的 P1-R05 命令结果：逐条记录 exit code、files/tests/skip 数、E2E passed 数、实际数据库隔离说明和完整 SHA。若任一命令失败，记录原始失败摘要并停止；不得尝试业务修复。

## 完成定义与回报

提交一个仅含 implementation record 的验证 commit。回报 branch、完整 HEAD、完整执行基线、三条命令原始摘要、数据库隔离说明、修改文件和 blocker。最后只能写：**“M4 P1 数据库验证已交 Codex 审核（非 GO）。”**
