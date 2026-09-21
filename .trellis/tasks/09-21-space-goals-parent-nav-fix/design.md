# Design

## Root causes

1. `--bd-muted` 在太空主题中承担了过多层级，同时部分表单组件保留 `bg-white`、`text-neutral-*` 组合，造成主题映射不完整时出现浅字白底。
2. `workspace="parent"` 在 900px 以上通过全局 CSS 把一级导航改成了左侧栏，与统一顶部导航目标冲突。
3. 代码已经读取 `goal_assignments.completed_by/completed_at`，但当前运行数据库只迁移到 0044；生产启动脚本又在存在旧 `.next/BUILD_ID` 时跳过构建，也未运行迁移，因此新代码、旧 schema、旧构建可能混用。

## Changes

- 增加专用的次级文字令牌，并统一主题容器内常见 `text-slate-*` / `text-neutral-*` 的颜色映射；`StudentMultiSelect` 改用主题语义色。
- 删除家长桌面侧栏布局覆盖，让所有角色复用同一个顶部一级导航。
- 生产 `start` 启动流程固定执行 `pnpm db:migrate` 和 `pnpm build`，失败即退出；开发模式不执行这两个生产步骤。
- 保留目标 route 对缺表/缺列的 503 映射，并通过现有目标 route/integration 测试和实际迁移验证。

## Deployment

生产环境拉取代码并安装依赖后，运行 `scripts\start-web-and-worker.bat start`；脚本负责迁移和构建。迁移是前向操作，必须先备份生产数据库并在维护窗口执行。
