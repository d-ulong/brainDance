# 最终交付指令：家长训练中心与验收

## 交接信息

- Active task：`09-04-credential-training-access`
- 分支：`main`
- 实现差异基线：`cf79f2e`
- 这是本需求的**最后一次实现交付**：在一次提交中完成家长训练中心、个人结果/趋势读取和全量验收证据。完成后只可“已交最终审核”，不得再拆分 P 阶段。

## 目标与固定边界

为已认证家长提供独立的 `/parent/training` 和 `/parent/training/[sessionId]`：选择现有训练、执行现有 runner、查看本人结果及个人趋势。复用现有协议、会话 API 与视觉组件，但不复用任何学生 ID、学生结果 URL、学生趋势读取 URL 或家庭学生详情 URL。

家长训练仅属于家长本人：

- 只能读取/写入自己的 session、metrics、projection 和趋势；跨家长、跨学生均 fail closed 且不泄露资源存在。
- 不生成或读取学生积分、计划/日程、家庭推送、通知、学生 profile/projection/trend。
- 成人页面须说明其为个人练习与趋势复盘，不构成诊断或排名；不得显示儿童年龄档、家庭成员比较或学生数据。

学生 UI、学生地址、现有家长查看**学生**训练页与家庭授权语义必须保持原样。

## 实现要求

1. 将可复用训练生命周期/导航抽为由调用方提供的 role、结果路径和训练入口路径的最小参数；不得把 parent 当 student，也不得复制整个 runner。学生仍跳转 `/student/training/[sessionId]`；家长跳转 `/parent/training/[sessionId]`。
2. 创建家长训练首页和三个训练入口，加入现有家长首页导航。入口和 runner 只能在 parent session 下可达；未认证/非家长回登录，未验证联系信息按既有家长门禁处理。
3. 创建家长结果页：仅通过通用当前主体 session API 读取结果，并展示本次指标和个人趋势。新增自有主体的 summary/trends API 时，route 只取当前认证 user，由 training service 再校验主体 authority；请求不得接受 owner/student ID。
4. 若现有 `TrendsPanel`、client API 或 DTO 含 `studentId`，将其收敛为当前训练主体的中性命名或增加最小的 subject-safe variant；不得让 parent 请求 `/api/family/students/*` 或 `/api/students/*`。
5. 复用现有 data-testid 和样式约定；新 parent 元素以 `parent-training-*` 前缀命名。所有交互支持触控/鼠标与 `Space`/`Enter`，沿用失焦与弱网重试语义。

## 禁止事项

- 不修改 migration/schema、P2 service authority/事务实现、密码功能、积分、日程、关系、推送、通知、worker 或删除策略。
- 不创建排行榜、成人诊断、家长积分或计划功能；不让学生查看家长训练。
- 不改 PRD/design/任务状态/签署/本指令；不顺手格式化无关文件。
- 不启动 Docker 或开发服务；不跑无关全量测试。仅为双视口定向 E2E 需要可使用已有构建流程，并在记录中说明。

## 必须覆盖的验收证据

1. desktop 与 mobile 各覆盖：家长登录 → 训练中心 → 开始一项训练 → 完成 → 家长结果页；断言 URL 始终在 `/parent/training`，结果为 `adult`，无学生 ID/积分/日程内容。
2. 至少一条 API/集成测试：家长的 self summary/trends 只含自身 `traineeId` 数据；另一个家长或学生不能读取该家长 session/trends。
3. 保留并运行 P2 的迁移/主体隔离测试，证明 UI 接入未削弱服务端边界；P1 密码三文件聚焦测试也作为回归运行。
4. 运行必要的 typecheck、lint、format、`git diff --check`。不要因方便改跑全量 suite。

## 交付

仅一次聚焦提交，包含 UI、最小安全 API/DTO、聚焦测试/E2E 和 `research/final-parent-training-implementation-record.md`。回报 HEAD、文件列表、R/AC 覆盖矩阵、实际命令与结果、未执行项/原因及风险；只写“已交最终审核”。
