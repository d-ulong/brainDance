# BrainDance

家庭学习、计划与认知训练产品的设计仓库。首期服务 5–18 岁学生及其家长，以训练、正式计划和可追溯积分结算形成家庭协作闭环；不提供医学、智力或心理诊断。

## 从这里开始

- [领域术语与业务规则](./CONTEXT.md)
- [设计文档索引](./docs/README.md)
- [持续更新的需求说明与变更台账](./docs/requirements.md)
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
docker desktop start
docker compose up -d
.\scripts\start-closed-pilot.ps1
```

前提是 Docker Desktop 正常运行。若 Docker 自身提示 unexpected error，先退出并重新打开 Docker Desktop；不要选择“Reset to factory defaults”，它可能清除数据库。Web 能启动不代表数据库可用。

2026-09-12 按所有者明确授权，此闭测库已不备份直接重建：当时的旧学生、计划、推送和会话已永久清除；截至 2026-09-13 当前已应用 43 条迁移。若只是 Docker 停止，应恢复 Docker 和容器，不必再次初始化数据库。

浏览器访问 [http://localhost:3002](http://localhost:3002)。关闭运行该脚本的终端，或在终端按 `Ctrl+C`，即可停止 Web 服务；数据库容器可按需以 `docker compose stop` 停止。

当前试点管理员账号为 `admin@local.braindance`；初始化口令为所有者指定的本机临时口令。当前库没有家长或学生账号，需先以管理员登录创建邀请码，再注册家长/学生或由家长创建学生。临时口令仅供本机使用，不提交 Git。不要在 `braindance` 库中新建同名账号，也不要把“初始化管理员”当成“重置已有密码”。

若登录再次显示 `Invalid credentials`，先确认服务是通过 `start-closed-pilot.ps1` 启动的，再确认浏览器访问的是该服务；不要根据该错误重试或重建默认 `braindance` 库中的管理员。

### 账号、家庭与界面

- “我的”显示姓名/昵称及完整登录账号。家长与学生注册、家长新建学生均必须填写姓名或昵称。
- 13–18 岁学生：管理员在“邀请码”中选择学生，学生在注册页选择学生，填写邀请码、用户名、姓名、出生日期及两次密码，注册后可直接登录。注册本身不授予家长权限；关联已有账号仍由学生确认。
- 5–12 岁学生：家长进入“学生 → 创建学生账号”，确认监护同意后，账号与家庭关联一次建立，不再单独绑定。学生首次登录修改初始密码。历史账号不依据姓名猜测归属或自动补绑。
- 首页展示真实今日任务、积分和训练近况；页面右上角可切换太空/糖果主题，偏好仅保存在当前浏览器，默认太空主题。低频“使用说明”点击展开，训练进度和错误不折叠。
- 新注册/常规改密继续使用 6–12 位、含大小写字母和数字、两次一致的规则。本次统一临时密码是所有者授权的本机例外，不放开常规密码政策。
- `start-closed-pilot.ps1` 仅监听回环地址，并显式启用本机试用模式：一分钟内 10 次失败等待一分钟；正常环境仍为 15 分钟内 5 次失败锁定 15 分钟。生产环境或非本机应用地址不能启用较宽松策略。登录错误会显示剩余等待时间，等待期间无需反复点击。

### 维护者重置入口

`scripts/reset-local-pilot-passwords.ts` 只允许回环地址上的精确试点库；默认只预览，`--apply` 才执行。必须显式设置指向试点库的 `DATABASE_URL` 和临时环境变量 `LOCAL_RESET_PASSWORD`，通过 `node node_modules/tsx/dist/cli.mjs scripts/reset-local-pilot-passwords.ts --apply` 执行，之后清除口令环境变量。操作会撤销当前所有登录，不会解除禁用或删除冻结，不记录明文密码。

本轮验证使用隔离库 `braindance_account_ui_test_20260909`，不属于业务库。不得把包含 TRUNCATE 的测试指向试点库。聚焦 UI 命令为 `pnpm exec playwright test --config playwright.account.config.ts`，配置要求该隔离库，使用 3003 端口；与其他同目录开发服务器不能同时运行。

## 仓库约定

- `.trellis/` 保存项目工作流、规范和任务记录。
- 本机 Codex 与共享代理运行配置位于用户级目录，不纳入仓库；`.agents/` 和 `.codex/` 已由 `.gitignore` 忽略。
- 环境文件、依赖缓存和日志不纳入版本控制。

## Windows 生产环境更新

停止旧 Web 与 Worker、备份生产数据库并拉取代码后：若 `pnpm-lock.yaml` 有变化，先运行 `pnpm install --frozen-lockfile`；然后运行 `scripts\start-web-and-worker.bat start`。该脚本会按顺序执行数据库迁移、当前源码生产构建，再启动 Web 与生命周期 Worker；迁移或构建失败时不会启动服务。本次更新未修改依赖锁文件，因此已有依赖完整时，拉取后可直接运行该启动脚本。
