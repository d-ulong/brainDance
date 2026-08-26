# M2 已知风险与延期项

> 规划阶段记录；实现前须与 `prd.md` Out of Scope 对齐。勿改写 M1 历史任务文档。

## 1. 同步结算与无 Worker

| 项 | 说明 |
| --- | --- |
| **风险** | 完成请求事务变长；结算逻辑 bug 可能导致「已完成但未记分」或「重复记分」若 UNIQUE 未覆盖 |
| **缓解** | settlement/ledger UNIQUE；集成测试强制同事务；E2E 断言 ledger 条数 |
| **延期** | Worker 异步结算 → **M3** |

## 2. 余额投影与 ledger 不一致

| 项 | 说明 |
| --- | --- |
| **风险** | 直接 UPDATE balance 或部分失败导致 drift |
| **缓解** | 仅 `ledger.service` 可写 projection；可选集成测试 `rebuildBalanceFromLedger()` |
| **延期** | 投影重建 CLI → **M3** |

## 3. 时区与日期边界

| 项 | 说明 |
| --- | --- |
| **风险** | `family_date` 与 `scheduled_at` 计算错误导致实例落在错误日 |
| **缓解** | Time Policy 单模块 + 固定 `Asia/Shanghai` + 边界单元测试 |
| **说明** | 中国无 DST；M2 不处理跨时区家庭 |

## 4. 计划前瞻重建竞态

| 项 | 说明 |
| --- | --- |
| **风险** | 编辑计划与完成/生成并发 → 重复 future 实例或 cancelled 误伤 |
| **缓解** | 事务内 cancel+regenerate；`occurrence_key` UNIQUE |
| **测试** | 并发集成测试（可选 P2） |

## 5. 过期：只读 effective vs 持久化（D4）

| 项 | 说明 |
| --- | --- |
| **风险** | 误在 GET 中 UPDATE → 隐藏副作用、测试污染 |
| **缓解** | `schedule-query.service` 只读；`expirePastPending` 仅维护/完成事务；AC-M2-F5/F6 集成测试 |
| **产品语义** | 列表可见 expired，但库内可能仍 pending 直至维护或完成尝试 |
| **延期** | Background 批量过期 Worker → **M3** |

## 6. 表级幂等竞态（D5）

| 项 | 说明 |
| --- | --- |
| **风险** | 并发 INSERT 同 scope+key 导致双写；跨命令误用同一 key 期望全局唯一 |
| **缓解** | M1 模式：先查 + ON CONFLICT + race 重查；§5.7 UNIQUE；`command-idempotency.test.ts` |
| **说明** | 无全局 command 表；跨命令类型同 key **允许** |

## 7. 无事实更正 / 冲销

| 项 | 说明 |
| --- | --- |
| **状态** | **M2 故意不做** |
| **运营风险** | 误操作完成无法自助撤销 |
| **缓解** | M2 范围外；管理员 DB 运维（非产品路径）；M3 引入更正 |

## 8. 单计划限制

| 项 | 说明 |
| --- | --- |
| **风险** | 产品后续需多计划；M2 DB 约束需迁移放宽 |
| **缓解** | 部分 UNIQUE 可 DROP；M2 文档明确限制 |

## 9. 固定模板扩展

| 项 | 说明 |
| --- | --- |
| **风险** | 仅一种「完成即加分」无法覆盖计时/质量模板 |
| **缓解** | 符合路线图 M2 最小闭环；M3 扩展 template schema |

## 10. 生产阻断项（继承 M1）

| 项 | 说明 |
| --- | --- |
| 管理员 TOTP | **仍为生产公网阻断**（`m1-deferrals.md`） |
| Outbox Worker | M2 写入 pending 不消费；生产依赖同步路径正确性 |

## 11. E2E 非交互执行

| 项 | 说明 |
| --- | --- |
| **风险** | Windows/Node 24 spawn、端口残留（M1 已修复） |
| **缓解** | 沿用 `run-e2e.mts` 监督器；Codex 独立复验两轮 |

---

**变更规则**：将本节某项移入 In Scope 须先修订 `prd.md` AC 并更新本文件。
