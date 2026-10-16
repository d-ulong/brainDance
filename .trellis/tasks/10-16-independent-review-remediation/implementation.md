# 实施与验收记录

## 用户验收后的公共首页与管理员入口整改

用户截图复现公共首页浅底浅字；此前日程/兑换主题检查没有覆盖匿名首页，因此原U5验收范围不足。已修复`.bd-action-card`固定浅色背景及继承浅字，改成配套主题token，标题18px、说明14px，并消除移动媒体规则缩小标题。新增真实匿名Chrome回归`public-entry-theme.spec.ts`，双主题×1280/360共4项通过：最低文字对比度太空10.65、糖果9.64，字号、无横向溢出、键盘进入登录和注册跳转通过。截图及结果在`evidence/public-*`，聚焦ESLint/Prettier/diff-check通过，独立代码复验GO。已重新构建并更新本地Docker环境。

用户另行明确确认“配置本地TOTP”。仅为`admin@local.braindance`生成本地专用密钥，写入忽略的`.env.docker.local`及`.review-runtime/admin-authenticator-setup.html`绑定材料，没有输出密钥到日志/审计、没有修改生产。已实际验证密码挑战、密码+TOTP登录、管理员会话和邀请码页面均HTTP200，并退出验证会话。未自动生成邀请码；明文邀请码只在用户点击生成时展示。验证使用上一时间步，当前时间步仍可由用户验证器使用。

## 本地验证环境更新（2026-10-16 15:06，Asia/Shanghai）

后续用户明确要求将当前环境所有账号密码统一设置为指定本地验证密码。操作前新增数据库备份 `backups/docker-local/braindance-local-before-password-reset-20261016-151131.dump`（249199 bytes，SHA256 `42a709883e06b0e26f365bfd3b5b928725f2c354edc47b718a40e286e0937f34`）；仅在容器内以严格校验 `postgres / braindance_local / LOCAL_PILOT_MODE / localhost:3002` 的一次性脚本复用本地重置流程，事务内更新3个账号、增加授权纪元、撤销会话、记录不含凭据的审计并复核全部哈希。角色、禁用状态和管理员TOTP策略保留。指定家长账号的新密码真实登录HTTP200，验证会话已清理。未将明文密码写入脚本文件、审计或运行记录，临时容器脚本已删除。

用户另行明确要求清除审核测试容器，并启动更新后的 `braindance-local` 验证环境。

- 已删除 `braindance-review-test-20261016` 及其专用匿名卷；未删除 local 的任何卷。
- 先备份现有 `braindance_local`，再核对金额约束兼容性（异常数量均0）。备份为忽略目录下的 `backups/docker-local/braindance-local-before-review-update-20261016-150513.dump`，244097 bytes，SHA256 `fb5b337e732351a569950fc91285b9f1713dd785d3361a467b9051e81346397d`。该仓库 backups 是既有 junction，真实位置为 `D:/work/codex/temp/archives/brainDance/backups/docker-local/`。
- `docker compose -f compose.local.yaml up -d --build` 成功，全部52个迁移已应用；数据库与网页 healthy，Worker started。宿主机 `/login` 200，匿名 `/api/auth/session` 401，入口 `http://localhost:3002/login`。
- 原学生/家长/管理员账号保留，未重新 seed 或重置凭据。管理员 TOTP 尚未配置，未创建或暴露密钥。
- `.dockerignore` 仅追加本轮依赖和验证缓存排除；本地启动文档修正管理员登记方式。原有未提交本地配置继续保留。此处是用户后续授权的本地环境更新，不是生产部署。

完整交付和19项问题矩阵见 [整改交付记录](../../../docs/independent-review-remediation-2026-10-16.md)。

- 已按用户规则完成全部代码整改。
- 静态复验及独立审核无剩余代码阻断。
- 隔离数据库52文件最新通过证据合计440项（分批）；纯单元136项。
- 浏览器28项会话恢复分轮通过，5组双主题/更正/兑换夹具流程通过。
- 生产外部服务配置与联调尚未执行。
- 当前停留工作流 Phase3.4：交付已具体可审阅，等待一次提交计划确认；未提交、未推送、未部署、未归档。
- 原有用户修改已在 commit-plan.md 排除；playwright.config.ts 仅部分暂存本次增量。
