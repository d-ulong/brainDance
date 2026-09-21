# BrainDance Engineering Memo

这里记录“当时怎么查、链路怎么走”的操作备忘。内容可以过时；执行前仍以当前任务、代码和规格为准。

## 记录经验的方式

2026-09-19 UI 审查：报告与44张截图位于 `docs/ui-audit/2026-09-18/`。3张为未登录实拍，41张使用浏览器内示例数据；已有E2E账号一次登录返回401，未完成真实家庭流程验证。`capture.cjs --sample` 拦截全部API，训练创建/事件也只返回本地示例响应。证据最初直接写入项目目录导致Next开发服务频繁热重载；改写到系统临时目录 `braindance-ui-audit-20260918` 后重新完整采集，再复制回报告目录。不要把中途热重载/截图夹具异常登记为产品缺陷。稳定证据包含日历内部滚动尺寸和 `modal-keyboard.json`；后者复现弹窗初始焦点未进入、Tab离开及Escape未关闭。本轮未实施UI修改。

2026-09-10 奖扣上限核查：`point_rule_templates.limits` 和 `negative_effect_schema` 虽在 `src/db/schema/points.ts` 中存在，0011/0015 模板种子均为 NULL。`point-rule.service.ts` 仅拷贝 effect，现有结算代码未读取 limits；家长页只有固定 +10 开关，未提供上限配置入口。上限目前是规格规划，不是已实现能力；后续须同时验证配置页、API、版本和结算应用，不能仅填字段就宣称完成。

每次发现可复用的根因时：

1. 将一句可迁移的原则写入 `lessons.md`。
2. 将定位路径、关键文件、验证命令和已知边界写入本文件。
3. 任务实施记录只保留该任务的验收证据，不取代这两个跨任务文件。

## M7 媒体上传单飞排查

### 2026-09-10 本机图片配置故障

加载 `.env.local` 后调用 `resolveConfiguredMediaRoot()`，重现 `BRAIN_DANCE_MEDIA_ROOT must be an absolute configured path`；只读检查返回 `loadedRootPresent=false`。相对路径得到不同的 absolute path 错误，候选 `D:/work/codex/brainDance/.braindance-media` 通过路径校验。未创建目录、写入图片或修改配置。

排查入口：`src/modules/family-content/private-media-store.ts` → `route-media-stores.ts` → `media-scanner.ts`，以及 `scripts/start-closed-pilot.ps1`。当前启动脚本未补媒体根目录，实际扫描 resolver 在本次加载环境返回 `scanner_not_configured`。目录修复后仍需验证真实扫描、重编码、存储和授权读取，不自动启用测试扫描替身。本轮仅诊断和登记需求，未宣称修复。

持续需求文档为 `docs/requirements.md`；未来更改计划、分配、计分或推送行为时同步正文与末尾变更台账，未确认口径不写成现行规则。

### 资源链路

`Route → getRouteMediaUploadIdempotencyLock → shared postgres.js authority → reserve session → advisory lock → lockedDb → upload pipeline → unlock → release`

检查顺序：

1. 确认 Route 的 lock adapter 与 `getDb()` 使用同一 shared SQL client；测试使用 `getTestDb()` 对应 client。
2. 确认 `reserve()` 后立即进入覆盖 adapter/ORM 初始化的 `try/finally`。
3. 确认 callback 中所有查询、事务和 audit 都使用 `lockedDb`，没有回退使用外层 `db`。
4. 确认扫描、重编码、对象存储 I/O 不在 `lockedDb.transaction()` 内。
5. 用小池（例如 `max=2`）、不同 key、barrier 和有限超时证明前进性；再测同 key 串行、callback 异常后重获锁。

### M7 媒体聚焦验证

- 上传连接锁：`pnpm test -- tests/integration/family-content/media-upload-idempotency-lock.test.ts`
- 媒体核心：`pnpm test -- tests/integration/family-content/family-media.test.ts`
- 迁移 gate：`pnpm test -- tests/integration/migrations/m7-media-student-binding.test.ts`
- 变更空白检查：`git diff --check <baseline>...HEAD`

共享数据库测试须串行；日常审核不重复全量 test/E2E/build，除非里程碑或风险证据不足。

## Migration lineage 不兼容时的门禁验证

症状：`pnpm db:migrate` 在现有本地库的 `drizzle.__drizzle_migrations` 中发现历史 SQL checksum 与当前 migration 文件不一致，并在写入前 fail closed。

处理顺序：

1. 保留原库和 ledger，不执行 reset、删除 migration 行或手工改 hash。
2. 新建仅用于验证的本地 PostgreSQL 数据库，并只将 `DATABASE_URL` 的数据库名替换为该隔离库。
3. 从空白账本运行一次 `pnpm db:migrate`；之后在同一隔离库执行需要数据库的 test/E2E。
4. 在任务实施记录中分别标注“既有库因 lineage 不兼容被 gate 阻断”和“隔离库验证结果”；隔离库保留到复核结束，清理需另行授权。

## Cursor 交接检查

- 每份 Prompt 指向唯一仓库指令，包含 branch、完整 baseline SHA、允许范围、禁止事项、验证和回报格式。
- 规划时先列出所有相互依赖的代码、迁移、UI 与验收；除非存在必须先 deploy 的安全前置条件，否则合并为一份完整 Cursor 指令。审核发现问题时，把尚未开始的依赖工作并入唯一集中整改，不另开 P 阶段。
- 并发/连接/事务任务先写资源控制流：`acquire → guard → initialize → use → cleanup`，逐步标注所有者与异常出口。
- 审核若发现设计级问题，停止补丁链；先新增阶段指令，再下发一次合并后的实现。

## 本机封闭试点登录排查

### 当前本机库映射（2026-09）

- 封闭试点的权威库为 `braindance_closed_pilot_20260903`；`scripts/start-closed-pilot.ps1` 会只在其子进程中选择该库。
- `braindance` 是 Docker 初始化及日常开发/测试默认库；它可以有不同的管理员数据，不能据此判断封闭试点账号是否有效。
- 历史 M7 验证库 `braindance_m7_gate_20260903b` 已在确认无代码引用、无连接后删除；不要在后续操作中重新指向它。

症状：`localhost:3002` 可访问，但新建隔离试点库中的管理员登录返回 `Invalid credentials`。

检查顺序：

1. 用 `netstat -ano | Select-String ':3002'` 找到实际监听 PID；不要只依据 `pnpm dev` 父进程是否存在。
2. 用真实 `POST /api/auth/login` 构造最小复现；隔离库中单独验证账号密码 hash、状态和锁定状态，输出不得含密码。
3. 若隔离库验证通过而 HTTP 失败，停止已识别的旧开发服务，再用 `scripts/start-closed-pilot.ps1` 启动；随后重跑同一 HTTP 登录请求。
4. 只在服务连接目标隔离库且 HTTP 返回 200 后才发放或使用邀请码；不要通过重置密码掩盖数据库错连。

## 前端主题与训练页签

- 主题唯一持久化键由 `src/components/ui/app-theme.tsx` 管理，根元素 `data-theme` 是 CSS token 的唯一入口；`space` 为无存储值时的默认主题，`candy` 为替代主题。
- `PageShell` 负责接入主题控制和 `TopTabs`；角色页签表集中在 `src/components/ui/top-tabs.tsx`，动态详情页按顶层路径高亮，避免逐页复制导航。
- 训练 runner 通过 `onBeforeNavigate` 接入离开保护；确认后调用 `cancelTrainingSession`，只有接口返回成功才由 `PageShell` 执行页签、返回或退出导航。浏览器关闭只显示 `beforeunload` 提示，不能假定服务端已取消会话。

## 2026-09-09 内容首页与开户链路

- 原首页只有菜单链接；原“我的”指向关联或改密页，session DTO 缺少姓名和账号；注册服务只实现家长路径，管理员 UI 也只发家长邀请码。现在身份链路为 users → `/api/auth/session` → `/account`；学生注册复用邀请码事务并校验生日/角色/姓名。
- 原家长创建仅写 users 和创建审计。现在调用 family-access 的 `activateFamilyRelationship`，账号、关系、成员、同意、纪元、审计/outbox 同事务；route 刷新家长 cookie，避免成功创建后被纪元变化登出。已有账号关联仍走原确认流程。
- 登录排查通过 `login_security_events` 确认家长账号实际出现 5/10 次错误及锁定事件；该证据不同于之前数据库错连。登录序列在账号锁下执行，错误计数也必须提交；安全事件使用 `clock_timestamp()`，避免 PostgreSQL 事务内 `now()` 相同造成解锁/失败排序不确定。
- 仅本机试点库 5 个现有账号完成受审计重置；审计 operationId 为 `8647f420-0f7e-4d10-8c8b-a9744435b9db`，逐个哈希校验通过，旧会话撤销。操作脚本拒绝 production、远程地址和其他库。不要在经验文件中复制口令。
- 核心聚焦命令：显式将 DATABASE_URL 指向 `braindance_account_ui_test_20260909` 后运行 `pnpm test tests/integration/identity/account-experience.test.ts tests/integration/identity/identity.test.ts tests/integration/identity/controlled-student.test.ts`，18 项通过。该库只用于验证，不能用业务库替代。
- 浏览器检查：`playwright.account.config.ts`，只跑首页/开户场景，桌面与 360px 两个视口；直接用 node 启动 Playwright 时需将仓库 `node_modules/.bin` 加入 PATH，供既有 global setup 调用 tsx。
- 浏览器首轮 10 项中 9 项通过；移动端注册失败源于退出辅助函数在按钮尚未出现时跳过退出。改为等待退出按钮可见后操作，最终仅复验受影响的首页/学生注册两个场景 × 两个视口，4 项全部通过；并非重复全量 E2E。
- 试点库原先缺少既有 0032/0033 训练迁移。核对历史 checksum 一致后，先保存 `.braindance-artifacts/backups/braindance-before-training-upgrade-20260909.dump`（205172 字节），再对精确试点库运行现有迁移脚本；迁移及兼容性检查成功。未修改历史 SQL、账本或删除业务记录。
- 收尾时 Docker Desktop 自身启动崩溃：`%LOCALAPPDATA%/Docker/log/host/com.docker.backend.exe.log` 显示 Inference manager 的 `dockerInference` 监听文件不可访问，所有 local engines 停止。额外家庭授权测试在 setup 因 PostgreSQL `ECONNREFUSED :5432` 未执行；真实试点 HTTP 登录验收也待 Docker 恢复。不要将这两项写为通过，禁止为恢复服务执行 factory reset。
- 同日用户恢复 Docker 后补验：家庭授权 9 项通过；试点 5 个账号真实登录和姓名/账号 DTO 均通过，4 个家长/学生账号 × 3 种训练概览共 12 次返回 200。退出使用 POST `/api/auth/session`，不是 `/api/auth/logout`。运行阻塞已解除，无需再次重置密码。

## 2026-09-11 封闭试点启动脚本解析失败

- Windows PowerShell 5.1 错读无 BOM UTF-8 的中文异常字符串，导致 `start-closed-pilot.ps1` 解析为未终止字符串；不是服务或数据库故障。
- 修复后以 `powershell.exe` parser 验证语法，再实测 `powershell.exe -File .\scripts\start-closed-pilot.ps1`：媒体检查通过、Next ready；`http://127.0.0.1:3002` 返回 HTTP 200。

## 2026-09-11 计划库接口 500（试点库漏迁移）

症状：已登录的家长访问 `/api/plan-library` 得到通用 `Internal server error`；隔离库的计划库集成测试已通过。

定位与恢复顺序：

1. 从 `scripts/start-closed-pilot.ps1` 确认运行库名为 `braindance_closed_pilot_20260903`，不要使用 `.env.local` 默认的 `braindance` 开发库。
2. 用仅查询 `information_schema.tables` 的 Node/Postgres 小检查核对 `plan_library` 是否存在；本次迁移前为 `false`，`drizzle.__drizzle_migrations` 存在，直接证明是运行库漏迁移而不是路由授权或前端列表问题。
3. 在任何写入前，读取 0029–0031 的已记录 hash，并与当前 SQL SHA-256 比较；三项均一致。确认 Docker 容器健康后，用容器内 `pg_dump -Fc` 导出 `backups/braindance_closed_pilot_20260911_before_plan_library.dump`（该目录已忽略，不提交）。
4. 仅将 `DATABASE_URL` 覆盖为该精确试点库后运行 `pnpm db:migrate`。0034–0038 成功应用；随后同一只读检查得到 `plan_library=true`、新增迁移数为 5。匿名请求 `/api/plan-library` 返回预期 401，不再是表缺失导致的 500。
5. 路由将 PostgreSQL `42P01` 映射为 503 和中文“计划库尚未迁移”提示，避免将部署问题伪装成通用内部错误。计划页的“新建后绑定学生”独立请求 `/api/family/students`，不再错误复用推送库响应中的学生列表。

验证注意：`tests/helpers/db.ts` 的 `resetIdentityTables()` 含 `TRUNCATE … CASCADE`，并通过 `requireDatabaseUrl()` 继承环境变量。2026-09-11 曾在未显式覆盖 `DATABASE_URL` 时运行计划库集成测试，测试因此重置了 `.env.local` 所指的 `braindance` 默认开发库；该库不是 `braindance_closed_pilot_20260903`。事后只读检查确认试点库仍有 5 个用户、`plan_library` 为 0 行。今后运行任何此类测试前，命令必须显式指向名称带 `_test_` 或 `_isolated_` 的库，且先核对该名称。

## 2026-09-11 计划/推送保存按钮无响应

根因：`PrimaryButton` 为避免嵌套操作按钮误提交，默认 `type="button"`；计划和推送表单的保存按钮未显式传入 `type="submit"`，所以点击不会触发 React 的 `onSubmit`，也不会产生网络请求。修复时不改变共享组件默认值，而是在全部表单提交按钮上显式标注 submit。

回归链路：`tests/e2e/plan-push-library.spec.ts` 以真实浏览器验证计划保存 POST、多学生绑定、移除绑定 DELETE、推送发布 PATCH 和草稿 POST。测试数据库明确为 `braindance_e2e_plan_push_20260911`，桌面与 360px 手机项目均通过。首次双视口回归因共用 fixture 状态导致第二轮少一个候选学生；用视口名称生成不同计划/推送标题后，保持同一账号但避免状态冲突。

## 2026-09-11 本机页面静态资源 404

症状：`http://localhost:3002` 显示无样式页面并永久“加载中”，控制台中 `/_next/static/...` CSS/JS 返回 404。

根因：在 3002 的 `next dev` 仍运行时，对同一工作目录执行了 `pnpm build`。生产构建替换 `.next` 文件，旧 dev server 仍返回带旧版本 query 的 HTML，因而引用已不存在的静态 chunk。

恢复：只读确认 3002 监听 PID 后停止该旧进程，使用 `scripts/start-closed-pilot.ps1` 重新启动。随后以 `Invoke-WebRequest` 验证首页和首页 HTML 实际引用的 `main-app.js` 均为 200。用户侧需 `Ctrl+F5` 丢弃旧 HTML/资源缓存。后续不得在试点服务运行时同目录 build；应隔离构建产物或停服重启。

## 2026-09-11 计划生成跨生效日被拒绝

症状：已绑定的计划在选择 `9/11–9/25` 生成日程时返回“当前没有启用或范围跨越切换日期”。

定位：`activatePlanLibrary` 默认从次日生效；原 `generatePlanLibraryRange` 查询同时要求 `effective_from <= from` 且 `effective_until > through`，因此任何请求范围只要多包含一个切换日前日期便直接拒绝。

修复与回归：查询改为寻找和请求范围相交的 activation，并将生成范围裁剪为 `[max(from, effective_from), min(through, effective_until - 1)]`；响应、审计和 outbox 均记录实际范围。使用隔离库 `braindance_plan_overlap_test_20260911` 运行 `pnpm test -- tests/integration/schedule/plan-library.test.ts`，新增“请求早于生效日”场景与既有两项共 3 项通过。业务试点库未参与测试。

## 2026-09-11 计划绑定 Internal server error

数据库日志给出了实际根因：`duplicate key value violates unique constraint "plans_active_formal_student_unique"`。不是迁移缺失；`.env.local` 的运行库为 `braindance`，其中迁移账本 39 条，计划/推送库五张表齐全，`plan_activations.rule_id` 也存在。

链路为：家长点击计划绑定 → `activatePlanLibrary()` 只查询 `plan_activations.effective_until IS NULL` 的旧计划 → 学生原有的 legacy formal plan 没有 activation 记录 → 新插入 active formal plan → PostgreSQL 唯一约束拒绝 → 未分类 PostgreSQL 异常被 API 显示为 `Internal server error`。

修复在同一事务内先查找该家长名下学生的 active formal plan；若它不是库 activation，标记为 inactive、取消生效日起的 pending 日程、写 audit/outbox，然后创建库计划。聚焦集成测试显式使用 `braindance_plan_overlap_test_20260911`，覆盖同日替换、旧式计划接管与跨生效日生成，5 项通过；`pnpm typecheck` 通过。浏览器端还将错误 Modal 升为 critical layer（z=200）、Toast 升为 z=210，内容项 fieldset key 改为稳定 index，推送详情补上每位学生的“查看作答与评论”链接。

## 2026-09-12 并行计划与多次作答迁移

- 新迁移为 `0039_parallel_plans_and_push_threads.sql`，必须同时登记到 `src/db/migrations/meta/_journal.json`；遗漏 journal 时 Drizzle 不会应用 SQL，代码会先出现“column priority does not exist”。
- 变更范围：删除 `push_answers` 的单 push 唯一约束，评论增加 `quoted_answer_id` / `quoted_comment_id` 且数据库 check 禁止同时引用；计划库与日程项增加 `priority`，日程增加 `suppressed_by_schedule_item_id`，删除每学生一个 active formal plan 的 partial index 与 activation overlap 约束。
- 核心服务：`answer.service.ts` 的 `submitPushAnswer()` 以 `(student_id, create_idempotency_key)` 只识别同一提交重放；`listPushAnswers()` 读取全部作答。`reconcile-schedule-priority.service.ts` 在同一学生同一时刻仅覆盖更低优先级项，等优先级并存；`start-plan-item`、`complete-schedule`、`persist-expired` 均排除被覆盖项。
- 验证只使用 `braindance_plan_overlap_test_20260911`：`pnpm test -- tests/integration/schedule/plan-library.test.ts --silent=true`（5 项通过，含优先级覆盖）；`pnpm test -- tests/integration/family-content/family-content.test.ts --silent=true`（11 项通过，含多次作答和引用评论）；`pnpm typecheck` 通过。执行前用 `$env:DATABASE_URL='..._test_...'` 显式覆盖。
- 本机 `braindance` 执行 `pnpm db:migrate` 时，0039 尚未运行即被 `media-migration-gate.ts` 拦住：历史 `0030_m7_media_student_binding` recorded hash 为 `b8036c4a0eb3…`，现文件 hash 为 `a077ae85419d…`。门禁明确要求保留旧库并重建本地非生产库；除非确认该库可重建，不能让运行库使用依赖 0039 的新代码。
- 所有者随后明确授权不备份重建 `braindance`：先精确核对 `pg_database` 的同名库与 owner，再终止该库连接、drop/create 同名库，运行 `pnpm db:migrate` 与 `pnpm db:seed`。迁移 gate 及 40 条迁移均通过；只读核对得到 5 个 0039 关键字段和 1 个种子管理员。封闭试点库与隔离测试库未触碰。种子管理员采用所有者此前指定的本机临时口令；不要把该临时口令写入 migration、日志或审计。

## 2026-09-12 学生页签遗漏与旧计划页

- 根因不是用户操作：学生卡仍链接到旧的 `/parent/students/[studentId]/plan`，该页并发读取旧“单正式计划、积分、日程”聚合；同时新计划页签只复用了计划库页面，未将学生上下文写入入口。
- 修复：学生卡改为 `/parent/students/[studentId]/plans`；旧 `/plan` 在认证后立即重定向，避免旧聚合请求；计划库通过 `useParams().studentId` 识别学生上下文，只显示该学生已绑定计划，并让新建计划默认绑定该学生。计划、推送和关联显示为学生内二级页签；顶层页签不再出现三者。
- 回归：`pnpm typecheck` 通过；隔离库上的计划库 5 项、家庭推送 11 项集成测试通过。lint 无新增 error；剩余警告均为既有未使用变量。

## 2026-09-12 实际运行库与学生二级导航复核

症状：重建 `braindance` 后，浏览器 3002 仍显示旧学生、计划和推送；新计划/推送代码又在真实页面出现缺字段导致的接口失败风险。

定位：用 Windows 进程树只读检查发现 3002 的 `next dev` 父进程是 `scripts/start-closed-pilot.ps1`，该脚本显式传入 `braindance_closed_pilot_20260903`。只读 SQL 显示该库迁移数为 39，且 `plan_library.priority`、`push_comments.quoted_answer_id`、`schedule_items.suppressed_by_schedule_item_id` 均不存在；此前被重建的 `braindance` 从未被 3002 使用。

恢复：将 `DATABASE_URL` 精确覆盖为闭测库并执行 `pnpm db:migrate`，成功得到 40 条迁移和三个关键字段。学生二级导航按全局“学生列表／创建学生／计划／推送／关联”实现，分别嵌入五个相应页面；这比将导航错误地塞进单个学生详情页更符合“原一级列表迁入学生菜单”的产品要求。`/parent/students`、`/parent/plans`、`/parent/pushes`、`/parent/link` 返回 200，`pnpm typecheck` 通过，lint 无 error。

数据重建：用户随后明确确认清空 `braindance_closed_pilot_20260903`。必须将断开连接、`DROP DATABASE` 与 `CREATE DATABASE` 分成独立 `psql -c` 调用；把它们放在同一 `-c` 字符串会导致 PostgreSQL 报 `DROP DATABASE cannot run inside a transaction block`，并可能让后续迁移错误地继续作用于旧库。重建后只读计数为：`users=1`、`students=0`、`plan_library=0`、`push_library_entries=0`、`family_pushes=0`、`migrations=40`、训练定义=12。

## 2026-09-12 家长导航与推送详情收敛

家长顶层训练入口迁入“我的”，兑换为独立顶层入口；学生二级只保留列表、计划、推送，创建和关联继续作为学生列表内操作。兑换目录因现有 API 以学生为授权边界，所以顶层入口先提供学生选择，再进入既有学生目录页，避免绕开资源授权。

推送库的一条内容可以对应多名学生的独立 `family_pushes` 投递；全局“查看”不能只跳转到各学生详情。复用既有 `getAnswer`、`listComments`、`createComment` 客户端契约，在同一 Modal 内为每个投递渲染独立线程；追加学生复用 `publishPushLibraryEntry`，只允许选择尚未投递者，图片随本次投递逐学生重新上传授权。

## 2026-09-12 推送评论状态与家长日程范围

`createPushComment` 的服务端契约只接受 `published` 推送；同一推送内容库条目能由不同发布批次产生不同状态的投递。聚合详情必须用 `getPush(studentId, pushId)` 读取每条投递状态，非 published 不渲染评论输入；异常通过父级 `ErrorDialog` 展示，不在业务卡片内散落错误文本。引用显示不需要新增 schema：用现有 `quotedAnswerId`/`quotedCommentId` 在同一已加载线程中解析并展示对应正文摘要。

家长日程查询复用既有 `/schedule-items?from&to` 授权 API；日期控件只在前端把选中日期明确换算为按日、周一至周日、整月的闭区间，不增加第二套日程读模型。兑换仍按学生资源授权，聚合页只并行调用已有关联学生的目录与记录 API，再提供学生/兑换项筛选和到单学生管理页的明确入口。

单学生兑换目录原先只可新增和启停；现有 `updateCatalogItem` 已允许修改名称、说明、积分和月限次，因此目录页用同一表单承载新增与编辑，并保留启停作为独立状态操作。错误统一复用 `ErrorDialog`，成功反馈保留轻量页面提示。

## 2026-09-12 v2.1 多学生推送公开期与兑换工作台

- `family_pushes` 和 `push_library_entries` 的 `answer_disclosure_days` 由 `0040_push_answer_disclosure.sql` 扩展；`NULL` 表示立即公开，`0–365` 是发布后整天数。迁移已登记 journal，并已作为非破坏性增量应用到封闭试点库 `braindance_closed_pilot_20260903`。
- 学生读取答案时，`answer-disclosure.service.ts` 通过同一 `push_library_publication` 的投递找到同内容的学生推送，再按发布时间和读取学生过滤。学生自己的答案始终可见；家长读取仍以单投递明细为准。评论读取同时审查来源：其他学生评论随公开期，家长无引用的普通评论可立即显示，含回复/引用的评论要等来源公开，避免借文字泄露答案。
- 家长 `/parent/redemption` 继续以每个学生现有授权 API 聚合数据，避免新增绕过家庭关系的跨学生读接口；左侧记录支持学生、项目和日期过滤以及审批，右侧商城用 Modal 创建、编辑和启停。学生页面展示“可兑换项目”和“我的申请”两列。手写作答目前没有可靠的浏览器画布上传链路，因此禁用并明确显示“功能待开放”，不再伪装成文件上传。

## 2026-09-12 测试默认库保护

`vitest.config.ts` 会运行全局 setup，单元测试同样会触发 `tests/helpers/db.ts` 的迁移和 `TRUNCATE`。一次未显式覆写 `DATABASE_URL` 的公开期限单测因 `.env.local` 指向 `braindance` 而清空了该开发库；封闭试点库 `braindance_closed_pilot_20260903` 未受影响。已将 `tests/helpers/db.ts` 改为只接受数据库名包含独立边界标识的连接串（`_test_`、`_isolated_` 或 `_e2e_`），迁移、共享连接和并发独立连接都走该保护。以后测试命令仍须显式传入隔离库，这个门禁只是防错兜底，不替代命令核对。

## 2026-09-12 学生看不到兑换项目

- 试点库只读证据：当前登录学生 `qiao` 自己的 `redemption_catalog_items.student_id` 计数为 0；两个启用项目“周末外出”“水果”都以 `hao` 为历史管理锚点，同一创建家长为 `long`。旧服务严格按 `catalog.student_id = 当前学生` 查询，因此返回空，不是前端缓存。
- 红色回归：同一家长关联两名学生、为第一名学生创建项目，第二名学生 GET 目录返回 200 但 `items=[]`。修复后同一测试验证第二名学生既能读到该项目也能成功提交兑换申请。
- 修复链路：学生列表按 `creator_parent_id IN 当前有效关联家长` 读取启用项目；申请事务用相同 authority 复核；创建和审批时的月限次查询与 advisory lock 增加 `student_id`，避免一个学生用满次数后阻止兄弟姐妹申请。家长聚合仍按管理锚点读取，避免同一共享项目重复显示。
- 界面同步：家长商城不再展示“归属学生”，卡片标识为“家庭共享”；新增时内部使用首名学生作为旧 schema 的管理锚点。`PageShell` 将退出按钮移到顶部 masthead，并提供二级导航槽位，把返回按钮放在同一行；学生列表、计划、推送、兑换页隐藏页签上方的标题说明区。

## 2026-09-12 评论引用消失与学生日程/计划收口

- 排查链路：先核对 `push_comments` 的三个引用 ID 与 DTO，确认事实没有丢；再对比家长、学生两个详情组件，发现页面各自只在当前投递数组中找目标；最后检查写服务，发现学生虽能读取已公开的兄弟投递，却只能引用当前 `pushId` 的目标。根因是跨层契约和可见范围不一致，不是单一 CSS 问题。
- 修复链路：`createPushComment` 用与读取相同的已公开兄弟投递集合校验引用；`PushCommentDto.reference` 随评论返回已授权的类型、作者与当前摘要；家长和学生共用 `CommentReference`，本地数组仅作兼容回退。两学生集成测试同时断言“能写”和“重新读取仍带作者/摘要”。
- 页面收口：推送详情按正文、投递/公开信息、作答、讨论重排；评论操作同行。日程抽成共享日/周/月组件，学生顶栏移除日程，首页与“我的”保留入口。学生计划沿用计划库，但服务端限定只能管理/启用本人计划；家长计划只读可补生成，自建计划积分强制为 0，避免自行给自己发积分。
- 验证口径：使用显式隔离库 `braindance_plan_overlap_test_20260911`；评论/日历单测 6 项、学生计划集成 1 项、跨投递引用集成 1 项通过，`typecheck` 与 `git diff --check` 通过。运行中的 3002 服务未执行 build，试点库未执行迁移、重置或测试清理。

## 2026-09-12 v2.4 日程状态、清理与互动体验

- “开始后颜色不变”的链路：`startPlanItem` 已写 `plan_item_rules.started_at`，但 `queryScheduleItems` 未 join 该表，`effectiveStatus` 和客户端 label/CSS 也没有 `in_progress`。修复必须四处同时接通，并以开始后重新查询断言。
- 直接完成链路：完成接口接收开始时间以及结束时间或时长；服务端以已有开始事实优先，校验任务日期、先后顺序、不得晚于服务器当前时间，再以实际完成时刻选择积分档。0041 允许 `manual schedule.completed` 保存 submitted_by 和执行区间，普通完成立即结算，不能冒充 system fact。
- 清理链路：DELETE 学生日程集合，日期限制为 today 起连续最多 90 天；事务锁学生日期范围，只把 pending 且无 started_at 的记录改为 cancelled。家长先验实时关系，学生额外限制 owner_id=actorId；audit metadata 支持同 key 重放与异载荷冲突。
- 兑换链路：创建申请事务先锁余额投影再比较价格；页面同时读取余额，余额不足直接 ErrorDialog，余额足够仍需 ConfirmDialog。审批、撤销、项目启停和评论删除同步使用确认语义。
- 展示链路：月历每格固定紧凑高度并最多显示五条摘要；推送正文改浅色，库卡整卡打开同页详情；媒体先发私有能力再生成缩略图 URL，查看器限制 1–4 倍并支持滚轮、拖动和双指缩放；评论按 parentCommentId 递归渲染，引用内容仍来自服务端授权投影。
- 验证：隔离库执行日程状态/月历单测 7 项、直接完成与清理集成 2 项、兑换余额门禁 1 项、引用/公开单测 5 项；试点库仅执行非破坏性 0041 迁移且兼容检查通过，未执行测试或清理。

## 2026-09-13 `pnpm dev` 缺少 caniuse-lite 模块

### 1. 根因分类

- 分类：C（变更传播失败）+ E（隐含假设）。为恢复 lint 而重建依赖时，受限环境中的递归删除产生大量“拒绝访问”，但后续安装仍覆盖到半删除的 `node_modules`；结果 `caniuse-lite` 包目录存在，`dist/unpacker` 却为空，Next 加载配置时失败。
- 责任边界：这是上一轮依赖修复操作造成的本地环境损坏，不是用户启动方式、Next 配置或业务代码问题。

### 2. 为什么前几次修复无效

1. 直接反复 `pnpm install --force` 只覆盖半删除目录，没有证明旧目录已完整移除。
2. 用 typecheck、单测或包目录存在作为旁证，没有把用户原始的 `pnpm dev` 设为最终放行门禁。
3. 从仓库根执行 `require('caniuse-lite/...')` 会受“传递依赖不在根级链接”影响，只能用于辅助定位，不能替代 Next 的真实解析链。

### 3. 有效恢复链路

1. 确认 3002 无监听进程，解析 `node_modules` 为绝对路径并验证它严格位于工作区下。
2. 在具有足够文件权限的环境中递归删除，并断言目录确实不存在；项目本地 pnpm store 已不存在，因此本次只删除 `node_modules`。
3. 使用稳定工作区运行时执行 `pnpm install --frozen-lockfile`；安装 389 个锁定包，未改动 `package.json`、`pnpm-lock.yaml` 或 `.npmrc`。
4. 包内 `caniuse-lite/dist/unpacker/agents.js` 恢复；随后实际运行 `pnpm dev`，Next 15.5.23 在 4.5 秒进入 Ready。
5. 请求 `http://127.0.0.1:3002/` 返回 200，并从 HTML 提取真实 `/_next/static/css/app/layout.css?...` 再请求得到 200。当前开发服务保持运行。

### 4. 防复发机制

- P0：删除失败即停止安装；状态写入 `.trellis/spec/backend/dependency-recovery.md`。
- P0：依赖恢复必须复跑用户原命令，并检查一个实际静态资源。
- P1：检查工具依赖损坏时不得为了 lint 临时改业务依赖或锁文件；记录未执行证据后先恢复环境。

## 2026-09-13 v2.5 目标、手动惩罚与计划日程工作台

- 数据模型：`0042_goals_and_manual_penalties.sql` 新增 `goal_definitions / goal_assignments / goal_commands / manual_point_adjustments`，积分来源扩展为 `goal_reward / manual_penalty / manual_penalty_reversal`。目标按定义复用、按主体独立状态；责任家长由创建或首位批准确定。
- 积分链路：目标成功奖励最多一条正向流水；手动惩罚先锁学生、读取余额，禁止负余额；只有原扣分家长可创建一条等额反向流水。所有写入与审计、outbox、余额投影同事务。
- 页面链路：家长学生工作台新增“目标”，含多学生创建、审批、评定、扣分与撤销；家长可把自己作为计划/目标主体并查看个人日程，个人事实强制不计学生积分。学生顶栏合并为“计划日程”，同页切换计划和日/周/月日程，最近目标和提案位于顶部。
- 推送收口：主推送库的卡片只打开同页 Modal，Modal 逐投递复用 `PushDeliveryThread` 展示全部作答/评论并允许家长评论；旧按学生列表/详情 URL 只负责带筛选参数跳到主库并自动打开对应 Modal。
- 验证：用临时 `braindance_v25_test_isolated` 迁移全部 schema，聚焦验证学生提案、责任家长权限、目标奖励、双家长扣分、越权撤销拒绝、原操作者撤销及余额恢复，2 个测试通过后删除临时库。`pnpm typecheck` 和 lint（0 error）通过。
- 运行库 authority：`.env.local` 基础 URL 指向 `braindance`，但 `start-closed-pilot.ps1` 会覆写为 `braindance_closed_pilot_20260903`。两库分别只读预检 `incompatibleReversals=0` 后应用 0042；真实页面验证以闭测试点库为准。启动脚本改为直接调用 `node node_modules/next/dist/bin/next`，规避 `pnpm exec next` 在当前 Windows 环境找不到 shim。

## 2026-09-13 推送媒体层级与家长个人计划排查

- 推送图片错进学生卡片的链路：`parent/pushes/page.tsx` 只渲染库内容，`PushDeliveryThread` 又按每个 delivery 调 `getPush()` 并渲染 `pushMedia`，因此同一推送附件被复制到每个学生区。修复为详情 Modal 读取首个有权 delivery 的媒体并在正文区展示一次，线程组件只加载作答/评论和发布状态。
- 多图限制同时存在于三个边界：Route 的 Zod `.max(1)`、`normalizePushContent()` 的 `> 1`、前端 `File | null`。必须一起改为 5，并用 5 成功/6 失败单测锁住，不能只改文件选择器。
- 家长个人计划排查用隔离库走 `createPlanLibrary → activatePlanLibrary(ownerId=studentId=parentId) → generatePlanLibraryRange`，再读取 `plans.plan_kind` 与 `plan_item_rules.entry.points`。日程表本身没有积分字段，不能用不存在的 UI/DTO 字段判断归零。
- 目标编辑沿 `goalDefinitions.revision → PATCH /api/goals/:assignmentId → updateGoal`；终态补充说明沿 append-only `goal_notes → POST /notes → listGoals.postNotes`。同一定义任一 assignment 终态后冻结核心配置，避免改写已评定目标的期望事实。

## 2026-09-14 计划上下文与家长代办日程

1. 计划说明已被 `src/modules/schedule/plan-definition.ts` 支持为可选 `description`；补完页面状态、DTO 和卡片投影即可，不需新建 schema 或迁移。
2. 家长学生日程页复用 `StudentScheduleWorkspace` 的 `actorMode="parent"`；不复制完成弹窗或积分摘要。后端变更在 `start-plan-item.service.ts` 和 `complete-schedule.service.ts`，route 需从 student-only session 切换为 trainee session 并显式传入 role。
3. 回归时至少断言：有关联家长能开始/完成，代为完成的 `fact_versions.submitted_by` 是家长，学生积分 ledger 产生且金额正确；默认未指定 parent role 的旧学生调用仍只能操作自己。
