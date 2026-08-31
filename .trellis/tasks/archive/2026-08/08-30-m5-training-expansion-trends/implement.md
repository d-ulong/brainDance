# M5 实施计划

## 固定信息

- Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
- 目标分支：`feat/m5-training-expansion-trends`
- 规划基线：`main@fd87ae680ad79072456bcbdbfe659af0638a01b8`
- 交付方式：Cursor 串行执行单阶段指令；每阶段提交后由 Codex 固定 SHA 审核。

## P1：训练协议与数据库不变量

- [ ] 盘点 reaction-only 分支和 schema 约束，先写 Stroop/digit-span 纯函数失败测试。
- [ ] 定义类型化协议接口、definition/event decoder 和指标方向，保留 reaction v1 兼容。
- [ ] 实现 Stroop v1 与 digit-span v1 固定协议的验证和指标计算。
- [ ] 幂等 seed 三年龄档定义；仅在必要时新增 active-definition/effective-session 约束 migration。
- [ ] 让 session service 按 training key 分派，验证正常、无效、乱序、重复、边界、幂等和并发。
- [ ] 核对审计/outbox 不含答案，并写 `research/p1-implementation-record.md` 映射 R/AC 与原始命令摘要。

P1 验证：

```bash
pnpm db:migrate
pnpm test tests/unit/training tests/integration/migrations tests/integration/training tests/integration/outbox tests/integration/audit
pnpm typecheck
pnpm lint
pnpm format
```

P1 禁止：趋势 API/UI、训练页面、M6、依赖升级、merge/rebase/reset/push/deploy。

## P2：趋势查询、投影重建与授权

- [ ] 固定趋势 DTO、窗口和 segment 契约，先写查询与重建失败测试。
- [ ] 将指标方向及聚合集中到共享 reducer，移除 reaction metric-key 特判。
- [ ] 实现 7d/30d/all 分段查询，只纳入 completed/effective。
- [ ] 覆盖版本升级、生日次日跨档、无数据/部分覆盖、practice/invalid 排除。
- [ ] 扩展 projection rebuild 并证明增量与重建一致。
- [ ] 实现学生本人/实时关联家长读取矩阵及解除关系后的即时拒绝。
- [ ] 写 `research/p2-implementation-record.md`。

P2 验证：

```bash
pnpm test tests/unit/training tests/integration/training tests/integration/projection tests/integration/api tests/integration/family-access
pnpm typecheck
pnpm lint
pnpm format
```

P2 禁止：训练交互 UI、M6、依赖升级、merge/rebase/reset/push/deploy。

## P3：学生/家长 UI 与联合验收

- [ ] 增加三项训练入口、Stroop/数字广度交互与统一结果展示。
- [ ] 增加学生/家长趋势窗口和版本/年龄档 segment 展示。
- [ ] 覆盖 Space/Enter、点击/触控、可见焦点、失焦、重复触发、刷新与重试。
- [ ] 在 desktop Chromium 与 mobile-360 完成三项训练、趋势和授权 E2E；验证无横向滚动。
- [ ] 建立 AC-M5-01～10 验收矩阵并串行运行全量质量门。
- [ ] 写 `research/p3-implementation-record.md`，列出所有未验证项和回滚说明。

P3 验证：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

P3 禁止：第四项训练、自适应课程、排行榜/脑年龄、M6、依赖升级、merge/rebase/reset/push/deploy。

## 审核与回滚点

每阶段必须是聚焦 commit，并回报 branch、完整 HEAD、完整执行基线、已解决 R/AC、修改文件、命令原始摘要和 blocker。Cursor 只能声明“已交审核”。Codex NO-GO 时先提交含稳定 R-ID 的集中整改文档；GO 后再提交下一阶段唯一指令。

若 schema、协议 DTO 或指标语义在 P1 审核中不成立，停止后续阶段并回滚到规划；不得用 UI 层兼容掩盖服务端契约缺陷。若 P2 重建与增量不一致，不得进入 P3。
