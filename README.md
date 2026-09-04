# BrainDance

家庭学习、计划与认知训练产品的设计仓库。首期服务 5–18 岁学生及其家长，以训练、正式计划和可追溯积分结算形成家庭协作闭环；不提供医学、智力或心理诊断。

## 从这里开始

- [领域术语与业务规则](./CONTEXT.md)
- [设计文档索引](./docs/README.md)
- [产品范围与验收标准](./docs/product-scope.md)
- [架构设计](./docs/architecture.md)
- [数据模型](./docs/data-model.md)
- [实施路线图](./docs/implementation-roadmap.md)

## 当前范围

首个可用闭环是：一位已验证家长、一名已关联学生、反应力训练、单时间点正式计划与固定积分模板。多家长授权、训练扩展、私密总结、兑换、导出和删除按路线图逐步交付。

所有项目术语以 `CONTEXT.md` 为准；持久化事实源、唯一约束和状态机以 `docs/data-model.md` 为准。详情见 [设计文档索引](./docs/README.md)。

## 本机封闭试点：启动与登录

本机封闭试点的权威业务数据库是 `braindance_closed_pilot_20260903`（`localhost:5432`）。它与 Docker 初始化及日常开发/测试使用的 `braindance` 数据库相互隔离：后者不是试点登录库，不能用于验证试点管理员账号。

| 数据库 | 用途 | 操作 |
| --- | --- | --- |
| `braindance_closed_pilot_20260903` | 本机封闭试点的正式业务数据 | 保留；启动试点时使用。 |
| `braindance` | Docker 默认创建的本机开发/测试库 | 保留；不用于试点账号登录。 |

不要直接用 `pnpm dev` 启动试点：它会读取 `.env.local` 的默认库。按以下方式操作，启动脚本会仅在该进程中把数据库切换到正式试点库，不会改写 `.env.local`：

```powershell
docker compose up -d
.\scripts\start-closed-pilot.ps1
```

浏览器访问 [http://localhost:3002](http://localhost:3002)。关闭运行该脚本的终端，或在终端按 `Ctrl+C`，即可停止 Web 服务；数据库容器可按需以 `docker compose stop` 停止。

当前试点管理员账号为 `pilot-admin@local.braindance`，角色为管理员，账号状态应为 active。管理员密码仅保存在受控本机密钥配置中，绝不写入 README、Git、日志或聊天记录；若密码遗失，请由维护者在 **`braindance_closed_pilot_20260903`** 中执行受审计的重置，而不要在 `braindance` 中新建同名账号。

若登录再次显示 `Invalid credentials`，先确认服务是通过 `start-closed-pilot.ps1` 启动的，再确认浏览器访问的是该服务；不要根据该错误重试或重建默认 `braindance` 库中的管理员。

## 仓库约定

- `.trellis/` 保存项目工作流、规范和任务记录。
- 本机 Codex 与共享代理运行配置位于用户级目录，不纳入仓库；`.agents/` 和 `.codex/` 已由 `.gitignore` 忽略。
- 环境文件、依赖缓存和日志不纳入版本控制。
