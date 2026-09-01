# M6 P3 唯一执行指令：UI、容量与恢复联合验收

## 固定信息

- Active task：`.trellis/tasks/08-31-m6-lifecycle-redemption-acceptance`
- 分支：`feat/m6-lifecycle-redemption-acceptance`
- 执行基线：以包含本指令的 Codex 阶段边界提交完整 SHA 为准
- 已冻结实现：P1 `064842a74bee0d683f01334b5cce70a881ec4cbc`；P2 `761df5365e3f31fdb83d507c1cc1250751ed2cd0`
- 本文件是 P3 唯一授权；`prd.md`、`design.md`、`implement.md` 和仓库规范是验收依据。

## 交付范围

### P3-R01 产品 UI 与 E2E

- 完成学生兑换/撤销、家长目录管理/审批、导出状态/下载、删除请求/撤销/学生确认 UI；复用现有 Route、DTO、错误类型和样式，不在客户端复制授权或状态机事实。
- 写操作携带稳定 `Idempotency-Key`；loading、空态、失败、终态冲突与危险确认清晰，状态不能只依赖颜色。
- Playwright 覆盖 desktop Chromium 与 360×800：成功主路径、越权不泄露、终态冲突、过期/已消费下载 token、冻结态、删除危险确认，并断言关键页面无横向滚动。

### P3-R02 合成容量验收

- 建立可复跑、供应商无关、仅允许隔离合成环境的 100 / 1,000 / 10,000 家庭容量脚本与使用说明。
- 脚本必须 fail-closed 拒绝非合成或无法确认隔离的连接，不得读取、复制或修改生产数据。
- 记录实际执行档位及连接数、队列深度、慢查询、导出/删除吞吐、耗时与资源边界；未执行档位明确标为 deferred，不外推生产容量保证。

### P3-R03 隔离恢复演练

- 建立可复跑演练：准备合成备份与删除/撤权事实，恢复后先重放 tombstone/撤权，再重建普通投影，最后执行正文不可复现、授权矩阵、余额、兑换及未删除历史 canary。
- 脚本必须 fail-closed 拒绝非隔离目标；不得绑定云供应商或接触真实生产备份。
- 记录实际 RPO/RTO、步骤结果、失败点、监控信号和回滚边界；不得把本地结果写成生产承诺。

### P3-R04 最终验收账务

- 写 `research/p3-implementation-record.md`，逐项映射 AC-M6-01～10 到文件、测试、命令和原始结果。
- 列出上线 blockers/deferred、监控指标及回滚说明。供应商、DPA、数据驻留、生产密钥、真实生产演练和法律期限不得因本阶段关闭。

## 验收要求

- AC-M6-07：恢复顺序与 canary 有可运行证据，tombstone/撤权先于普通投影恢复。
- AC-M6-08：三个合成档位的脚本均可选择执行；只把实际运行结果记为通过。
- AC-M6-09：双视口联合主路径及所列错误路径可定位，无横向滚动。
- AC-M6-10：migration、全量 test、typecheck、lint、format、build、E2E 串行验证；未通过或未执行项如实记录。
- 不得为通过验收削弱 P1/P2 权限、冻结、幂等、删除、tombstone 或一次性下载契约。

## 验证

至少执行并记录：

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
```

容量与恢复脚本落地后，在实施记录中固定其真实命令、保护参数和结果。共享数据库测试串行运行；若环境限制导致未执行，标为 blocker/deferred，禁止伪造结果。

## 禁止项与提交

- 禁止生产部署、生产数据/备份、云供应商绑定、依赖升级、M7/M8、无关重构，以及 merge/rebase/reset/force-push。
- Codex 与 Cursor 使用同一目录：不要 pull/fetch、切分支或创建 worktree；开始前只核对分支、HEAD 与干净工作区。
- P3 完成后只创建一个聚焦提交，包含实现、测试、脚本和实施记录；不要修改任务状态、签署文件或启动下一阶段。

## 回报格式

仅回报：分支、完整 HEAD、完整执行基线 SHA、完成的 P3-R/AC-ID、修改文件、各验证命令原始摘要、实际容量/恢复结果、blocker/deferred。结尾必须写“已交审核”，不得自行声明 GO。
