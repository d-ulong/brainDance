# 主题与顶部页签改造：实施计划

## Single delivery scope

1. 提取主题 token、`ThemeProvider`/切换控件和角色顶部页签；为 theme、tab、当前项提供稳定测试选择器。
2. 扩展 `PageShell` 与共享 UI 原语，使现有页面获得两套主题和顶部工作区导航；保留未认证/受限页面的访问 gate。
3. 以单一路由表覆盖学生、家长、管理员的主入口和动态详情高亮；调整首页由菜单页变为概览页。
4. 为三种学生/家长训练 runner 接入离开 guard，复用现有 terminate endpoint，处理取消、失败、提交中和浏览器离开。
5. 新增/扩展聚焦 Playwright 覆盖：默认主题、切换后持久化、不同角色 tab、360px 无横向页面溢出、训练页取消/确认离开。

## Required review checks

- 固定基线 SHA 后审阅变更；确认不引入 API/schema/migration、不会展示越权页签、不会删除既有 E2E test ID。
- 搜索所有 `PageShell` 使用点及角色路由，确认共享 shell 覆盖范围和受限页面排除符合 PRD。
- 审阅训练离开路径：确认 API cancel 成功才导航，失败不导航，且不会和 submit 并行重复写入。

## Validation

- `git diff --check <baseline>...HEAD`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
- 聚焦 Playwright：新增主题/页签 spec 与现有 `home.spec.ts`、`m5-training-flow.spec.ts`，desktop-chromium 和 mobile-360 均运行。

如共享试点库/浏览器环境无法运行完整 E2E，记录阻塞原因和已运行的精确命令；不得伪称通过。

## Rollback

一个聚焦提交即可整体回退 UI 改造；无数据库或 API 回滚步骤。
