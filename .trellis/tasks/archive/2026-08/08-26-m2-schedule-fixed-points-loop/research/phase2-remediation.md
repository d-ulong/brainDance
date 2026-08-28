# M2 Phase 2 Time Policy 整改清单

> 结论：**GO（Phase 2）**
> 最终签署 HEAD：`f82bd34d857df776b3dfad7d317ca25918009ad3`
> 固定基线：`32774526cdc8c046cf58b36833627191079c86f1`
> 范围：implement §1 Phase 2；`src/modules/time-policy/` 与 `tests/unit/time-policy/`

## 1. 已通过范围

- `addFamilyDays`、`nextFamilyDate`、`familyDateRange`、`horizonThrough` 的日期与上界契约通过。
- completion window 的起止边界与 `on_time` / `late` 语义通过。
- 代码保持纯计算且不依赖宿主本地时区；未提前实现 Phase 3。
- 定向测试、全量测试、typecheck、lint、format、build、diff-check 均通过。

## 2. 唯一阻断项

### TP-R1 — 家庭本地时间换算必须只有一个实现源

**文件**：

- `src/modules/time-policy/to-scheduled-at.ts`
- `src/modules/time-policy/completion-window.ts`

**问题**：两个文件分别复制了相同的 `timezoneOffsetFor()`，并分别硬编码 `"Asia/Shanghai"` 与 `"+08:00"`。这违反 design §1 的 Time Policy 单点原则、AGENTS.md §2/§3 以及代码复用指南的重复常量规则；未来调整权威时区时会形成两个可能漂移的维护点。

**整改动作**：

1. 提取一个最小的、仅属于 `src/modules/time-policy/` 的共享 family-local date/time → UTC `Date` 原语。
2. `toScheduledAt()` 与 `completion-window.ts` 必须共同复用该原语，删除两处私有 `timezoneOffsetFor()`。
3. 家庭时区名称仍由现有 `familyTimezone()` / `to-family-date.ts` 单点拥有；不得在消费者再次声明 `"Asia/Shanghai"`。
4. UTC offset 或等价换算逻辑也只能存在于共享原语的一处；不得添加依赖或第二套时区模块。
5. 保持全部公共导出签名和已通过行为不变，不修改 M1 契约，不进入 Schedule/Settlement/Route/Web/E2E。

**验证**：

- 保留 `to-scheduled-at.test.ts` 与 `completion-window.test.ts` 的全部边界断言。
- 增加或调整聚焦测试，使两个公共消费者均经共享换算源得到既有结果；测试不应复制生产实现。
- `rg -n 'timezoneOffsetFor|Asia/Shanghai|\\+08:00' src/modules/time-policy` 的结果必须证明：时区名称只有既有权威定义，offset/换算逻辑只有共享原语一处，不再出现在两个消费者中。

## 3. 完成定义

- 仅关闭 TP-R1；不得重写其他已通过模块。
- 提交一个聚焦 commit。
- 运行 Phase 2 全部验证命令并按 Codex–Cursor 固定格式回报。

## 4. Phase 2 最终签署

**签署基线**：`f82bd34d857df776b3dfad7d317ca25918009ad3`

**结论**：GO。TP-R1 已关闭，Phase 2 的家庭日期、日程时刻、horizon、完成窗口和 completion kind 纯函数可作为 Phase 3 Schedule 实现的固定依赖。

### 双轴审核

- Standards：PASS，0 个阻断项。两个消费者统一复用 `familyLocalInstant()`；重复换算与 offset 函数已删除。`offsetForFamilyTimezone()` 的恒真保护属于非阻断冗余，不影响固定 Asia/Shanghai 契约。
- Spec：PASS，0 个发现。时区名称仅保留于既有权威定义，offset/换算逻辑仅位于共享原语，公共契约和窗口边界未回退，无 Phase 3 范围扩张。

### 最终验证证据

| 命令 | 结果 |
| --- | --- |
| `rg -n 'timezoneOffsetFor|Asia/Shanghai|\+08:00' src/modules/time-policy` | PASS；timezone helper 无残留，时区名与 offset 各仅一处 |
| `pnpm exec vitest run tests/unit/time-policy tests/unit/training/time-policy.test.ts` | PASS，9 files / 44 tests |
| `pnpm test` | PASS，22 files / 110 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors；3 个既有 warnings |
| `pnpm format` | PASS |
| `pnpm build` | PASS |
| `git diff --check fa7bfcaa...f82bd34d` | PASS |

### 签署边界

- GO 仅适用于上述固定 SHA 和 implement §1 Phase 2。
- 本签署文档必须先形成独立 Codex 文档提交；该提交 SHA 才是 Phase 3 的固定基线。
- Phase 3 只实施 Schedule：CRUD、inline horizon、maintain-horizon、complete/skip；不得夹带 Settlement、Route、Web 或 E2E。
