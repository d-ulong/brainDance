# M5 P3 集中整改 Cursor 执行指令

> Active task：`.trellis/tasks/08-30-m5-training-expansion-trends`
>
> 目标分支：`feat/m5-training-expansion-trends`
>
> 固定候选实现 SHA：`a5d021eb6b057bb9cfb93a11a560060c9b2cc138`
>
> 整改轮次：**P3 第 2/3 轮；一次性关闭 P3-R01～P3-R04。**
>
> 结论：**NO-GO；只授权本文件整改，不授权归并或 M6。**

## 1. 验收线与非阻断项

以下四项直接影响 R-M5-06～08、AC-M5-08～10 及权威事件正确性，必须同一提交关闭。生命周期 hook 职责偏多、三页提示 UI 重复、趋势快速切换可能短暂接收旧响应等仅记非阻断代码债；不得扩大重构。

P1 race helper 的极端清理/诊断失败继续按既有签署记为非阻断，但本轮新增的 P3 聚焦测试和 E2E 必须全部通过。

## 2. P3-R01 — 键盘路径伪造答案或输入来源

- **依据**：R-M5-06、R-M5-08、AC-M5-08；`design.md` §5：“Space/Enter 与点击走同一动作处理器”。
- **位置**：`stroop/page.tsx`、`reaction/page.tsx`、M5 E2E helper/spec。
- **原因**：Stroop 全局 Space/Enter 直接提交 `currentTrial.inkColor`，无论用户聚焦/选择哪个选项都自动答对；E2E 依赖该捷径，形成假绿证据。Reaction 的 pointer click 固定记录 `inputMethod: "keyboard"`，使权威事件来源失真。
- **修订动作**：键盘通过原生聚焦按钮或明确选择状态调用与 pointer 完全相同的选项处理器，不得推导/自动传入正确答案；Reaction handler 必须接收并记录真实 `pointer | keyboard` 来源，同时保持重复触发 guard。
- **验证**：Stroop 键盘可明确选择一个错误色与一个正确色，服务端结果分别反映真实选择；聚焦选项按 Space/Enter 与点击同一选项生成等价事件。Reaction pointer/keyboard 的事件 payload 分别准确。E2E 不得读取正确答案或调用自动正确路径。

## 3. P3-R02 — 数字广度在作答阶段泄露刺激序列

- **依据**：R-M5-03、R-M5-06、AC-M5-08；产品范围的数字广度顺背/倒背训练语义。
- **位置**：`digit-span/page.tsx`、`digit-span-plan.ts`、`m5-training-helpers.ts` 和 E2E。
- **原因**：UI 进入 response phase 后仍持续显示完整 digits；E2E 直接读取可见序列并复制/倒序，因此交付的是抄写而非记忆训练。
- **修订动作**：提供可理解且有界的刺激展示阶段，结束后隐藏完整序列再开放输入；暂停期间不得继续展示/推进计时。不得以 sr-only、data attribute、DOM 文本或 test-only 环境分支向 E2E/用户泄露期望答案。
- **验证**：E2E 在刺激阶段只观察展示/阶段状态，进入 response 后断言完整序列不可见且 DOM 无期望答案；使用测试自身已知输入完成顺背/倒背的正确与错误路径，不从页面读取答案。

## 4. P3-R03 — append 与失焦恢复存在事件序号竞态

- **依据**：R-M5-07、AC-M5-09；P3 指令 §2.4；权威事件必须顺序、幂等。
- **位置**：`use-training-session-lifecycle.ts`、`use-training-blur.ts`、三项训练页及相关测试。
- **原因**：恢复可见时先 `setPaused(false)`，再 fire-and-forget `session.blur`；用户响应可与 blur/stimulus append 同时读取相同 `sequenceRef`。初始 stimulus 在 append 完成前也可能已开放响应。blur 上报最终失败未进入明确恢复失败/abandoned 状态。
- **修订动作**：所有 session event append 经单一串行队列/互斥入口提交并只在成功后推进 sequence；刺激事件成功后才开放响应。恢复期间保持暂停，blur 写入成功且服务端未 abandoned 后才恢复交互；累计超 30 秒、恢复写入失败或重试耗尽进入明确终止/可行动状态，不允许继续答题或 submit。
- **验证**：聚焦组件/集成测试证明 stimulus→response→blur/恢复的严格序号、重试同序号和无重复事件；快速恢复后立即输入不能越过 blur；失败路径无未处理 rejection。

## 5. P3-R04 — 必需 E2E 只验证提示，未证明最终一致性和授权撤销

- **依据**：AC-M5-09～10；P3 指令 §2.7、§4。
- **位置**：`tests/e2e/m5-training-flow.spec.ts`、helper 和验收矩阵。
- **原因**：弱网用例看到 retry banner 后即结束，未证明事件/submit 最终成功、顺序和去重；短失焦只验提示显隐；缺少 >30 秒 abandoned、恢复失败，以及家长解除关系后趋势即时拒绝的 P3 E2E。实施记录用旧 M1 unlink 测试替代本阶段要求。
- **修订动作/验证**：在 desktop 与 mobile-360 项目中用确定性 route/clock/可观察状态完成：
  1. 短失焦后继续并只完成一次；
  2. 累计 >30 秒或恢复失败后 abandoned 且不能继续提交；
  3. event 与 submit 各至少一次短暂失败，最终完成且服务端记录顺序正确、无重复；
  4. 已关联家长可读，解除目标关系后刷新/重新登录立即 403/不可见，其他有效家长不受影响；
  5. 保留三训练、键盘/点击、趋势 segment 与无横向滚动双视口证据。

不得仅断言 banner、mock 最终业务结果或依赖固定 sleep 证明顺序。更新 `p3-implementation-record.md` 的 AC-M5-01～10 矩阵和真实用例计数。

## 6. 允许范围与禁止项

只允许修改关闭 P3-R01～R04 必需的 P3 training UI/components/client API、M5 E2E/helper、聚焦前端测试与 `p3-implementation-record.md`。如确需复用已存在的 terminate/read API，可做最小调用接线；不得修改 P1/P2 服务端协议、指标、趋势、授权或锁语义。

禁止 schema/migration、依赖升级、第四项训练、排行榜/诊断、M6、无关重构、修改规格/本指令；禁止 merge/rebase/reset/push/deploy。

## 7. 完成定义与验证

```bash
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm test:e2e
git diff --check <完整执行基线SHA>..HEAD
git status --short --branch
```

数据库及 E2E 无其他 runner 时串行执行。全量 unit/integration 中仅已签署的 P1 helper 诊断债可单列非阻断；P3 聚焦、build、desktop/mobile E2E 均必须退出 0。只创建一个聚焦整改 commit。

## 8. 固定回报格式

```text
branch: feat/m5-training-expansion-trends
HEAD: <完整整改 SHA>
execution_base: <包含本指令的完整 SHA>
status: M5 P3 集中整改已交 Codex 审核（非 GO、未归并）

resolved:
- P3-R01: <真实键盘选择与 inputMethod 证据>
- P3-R02: <刺激隐藏且无答案泄露证据>
- P3-R03: <串行事件/恢复/abandoned 证据>
- P3-R04: <弱网最终一致性及解除关系双视口 E2E>

changed_files:
- <文件>

verification_raw_summary:
- <命令>: <原始摘要>

e2e_matrix:
- desktop Chromium: <用例数与结果>
- mobile-360: <用例数与结果>

blockers:
- <无则写 none>
```

最后一句必须是：**“M5 P3 集中整改已交 Codex 审核，未归并、未启动 M6。”**
