# 实施记录（2026-09-09）

## 已实现

- AC1–AC2：真实内容首页、桌面双栏/手机单栏、图形 Logo、紧凑页头与可展开说明；保留顶部页签及浏览器保存的两套主题。
- AC3–AC4：姓名和完整账号展示、必填名称、学生邀请码和 13–18 岁自主注册；低龄维持家长创建。
- AC5：新建学生与家庭关系/成员/监护同意/纪元/审计/outbox 同事务；重放不重复开户，刷新家长会话；已有学生关联保持确认。
- AC6：登录提交防重、失败记账事务、过期解锁计数边界、剩余等待时间、本机限定宽松策略。
- AC7：精确试点库 5 个现有账号完成授权重置，哈希逐个校验通过，旧会话撤销、锁定清零；未解除禁用/删除冻结。
- 同步 README、产品流程/范围、CONTEXT、lessons、memo。现有试点库的缺失训练迁移经备份和兼容性检查后补齐，未新增或修改历史 migration。

## 聚焦验证证据

- 身份核心：account-experience / identity / controlled-student 三文件共 18 项通过，使用隔离库。
- UI 首轮：10 项中 9 项通过；修复移动端退出 helper 的等待条件后，仅复验首页/学生注册，桌面和 360px 共 4 项通过。最终日志 `test-results/account-ui-final.log`；截图位于对应 Playwright 输出目录。
- typecheck、变更 TypeScript 文件 ESLint、变更空白检查通过。未执行全量 test、全量 E2E 或 build。
- 密码重置 operationId：`8647f420-0f7e-4d10-8c8b-a9744435b9db`；不记录明文口令。
- 既有 0032/0033 迁移成功，日志 `test-results/pilot-migration.log`；备份位置见 README。

## 运行验收与恢复

Docker Desktop 在收尾阶段因 dockerInference 监听文件异常自行启动失败。额外 family-access 聚焦测试在全局 setup 遇到 ECONNREFUSED，未进入断言；真实试点 HTTP 登录/训练接口复核尚未完成。3002 Web 开发服务启动成功，不代表数据库可用。

用户恢复 Docker 后，2026-09-09 补验通过：

- `family-access.test.ts`：隔离库中 9 项全部通过，耗时 12.30 秒，覆盖关系接受/拒绝、权限、幂等并发及会话纪元失效。
- 实际 `http://localhost:3002`：试点库全部 5 个账号登录 HTTP 200；session 姓名/账号非空且角色一致。
- 2 位家长和 2 位学生的 reaction、stroop、digit-span 概览共 12 次 HTTP 读取全部 200；最终验证会话通过 POST `/api/auth/session` 退出。
- 验证命令初次误用不存在的 `/api/auth/logout` 返回 404；改用仓库实际退出路由后完成，未改动业务代码。

运行阻塞已解除，本轮仅补剩余验证，没有重跑全量测试、重置密码或迁移。实现及运行验收已通过；工作区保留未提交变更，任务尚未提交/归档，不推送。
