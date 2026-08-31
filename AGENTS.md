# Engineering Behavioral Guidelines

Use these guidelines for work under this directory. Project-specific instructions and explicit user requests take priority where applicable.

## 1. Clarify Material Ambiguity

Before implementation:

- Briefly state assumptions that materially affect the solution.
- Make reasonable, low-risk assumptions when they do not materially affect behavior or scope.
- Ask before proceeding when ambiguity could materially change behavior, architecture, data, or the requested scope.
- Mention a clearly simpler approach or an important tradeoff when relevant.

## 2. Prefer the Smallest Sufficient Solution

- Implement only what the request requires. Remove speculative features, future-only fields or branches, configurability, and imagined requirements (YAGNI).
- Before writing business code, stop at the first sufficient option: no implementation needed; reuse an existing project implementation; use the standard library; use the framework or platform's native API; reuse an already-installed dependency; use a short, clear implementation; otherwise write the minimum viable business logic.
- Do not add a third-party dependency when the project, standard library, platform, or an installed dependency already provides a sufficient solution.
- Do not add wrappers, intermediate layers, or abstractions for hypothetical extensibility. Introduce an abstraction only when it removes meaningful duplication, clarifies a real domain boundary, or the user explicitly requests architecture or encapsulation.
- Prefer concise, readable, maintainable code—not code golf. If the implementation is substantially more complex than the problem requires, simplify it.
- Never trade correctness or safety for brevity: preserve necessary input validation, boundary checks, error handling, security controls, and data-integrity guarantees. Avoid defensive layers only for scenarios excluded by established invariants.
- When the user explicitly requests an abstraction, encapsulation, or architectural design, follow that request instead of applying these constraints mechanically.

## 3. Keep Changes Focused

When editing existing code:

- Limit changes to the requested behavior and the updates required to keep the code correct and internally consistent.
- Preserve the repository's existing style and conventions.
- Do not refactor, reformat, or remove unrelated code.
- Remove imports, variables, functions, and files made obsolete by your own changes.
- Mention unrelated problems you notice, but do not fix them unless asked.

## 4. Work Toward Verifiable Outcomes

Before substantial or multi-step work, define a short plan with a verification method for each step.

For behavior-changing work:

- Use existing tests when available.
- Add or update a focused regression test when the repository has a suitable test setup.
- Otherwise, perform the smallest practical verification and clearly report any verification that could not be completed.
- Continue until the requested outcome is verified or a concrete blocker requires user input.

For trivial changes, skip formal planning and use proportionate verification.

## 5. Codex–Cursor 协作协议

本项目采用「Codex 设计与审核、Cursor 实现」的固定分工。仓库任务文档和已提交 SHA 是唯一事实来源；聊天只用于通知。

### 角色边界

- **Codex**：澄清与冻结规格；维护任务、整改、签署和下一阶段指令；固定 SHA 审核并给出 GO/NO-GO；直接执行低风险机械操作和 Trellis 账务。除协作文档、签署记录、必要流程配置及下述机械操作外，不代写 Cursor 负责的业务代码。
- **Cursor**：只在 Codex 已授权的任务、分支、基线和范围内实现业务代码、测试并提交；不得创建或改写任务指令、规格、签署、`task.json`，不得扩大范围、创建未授权分支、启动下一阶段或自行放行。
- **共同**：每次交接都写明任务路径、分支、完整 SHA 和阶段状态。

### 默认执行边界

为减少无价值往返，按“能安全直接完成的人直接完成”执行：

- **Codex 直接执行**：只读检查、固定 SHA 审核、文档/任务/签署维护、`git add/commit`（Codex 自己产生的协作文件）、仅快进归并、普通 push、SHA 核对、任务归档、开发日志，以及其他范围明确、低风险、可恢复且不涉及业务实现判断的机械操作。
- **Cursor 执行**：已冻结范围内的业务代码、migration/schema、测试实现和需要其本地开发上下文的整改。
- **必须停下询问**：非快进归并、冲突处理、历史改写、force-push、部署、数据破坏、权限/密钥操作，或任何会扩大已冻结范围的动作。
- 不得为了“让 Cursor 执行”而把一个本可由 Codex 一次完成的检查、push、归档或账务操作拆成新的阶段或多轮 Prompt。

### 单阶段交接

每个 Cursor prompt 只要求一个可验证的实现或整改阶段，并必须指向一份唯一的仓库指令。**仓库指令是完整事实源，聊天 Prompt 只做启动通知，不重复粘贴指令正文。**

默认 Cursor Prompt 只包含：

1. `Active task`；
2. 唯一仓库指令路径；
3. 目标分支与完整执行基线 SHA；
4. 开始前分支/HEAD/干净工作区检查，以及“不一致即停止”；
5. “严格按指令实施、验证、提交并按固定格式回报”。

允许范围、禁止项、R/AC-ID、完成定义、验证命令、提交要求和回报格式全部写在唯一仓库指令中。只有指令存在歧义或临时安全状态发生变化时，Prompt 才补充最少必要说明；聊天补充不得修改仓库指令的验收线。

推荐模板：

```text
Active task: <task path>

请严格执行唯一指令：<directive path>
目标分支：<branch>
完整执行基线：<full SHA>

开始前确认分支、HEAD 与工作区干净；不一致立即停止报告。
严格按指令实施、验证并提交一个聚焦 commit，完成后按指令固定格式回报。
```

### 整改与审核

- **整改先文档化**：Codex 在同一轮审核中发现的全部可执行问题，必须一次性写入任务目录的整改文档并提交。每项使用稳定 ID，列明依据、文件、原因、修订动作、验证方式和允许范围。不得让 Cursor 从聊天猜测问题。
- **固定基线审核**：Codex 以 Cursor 已提交 SHA 审核规格、工程规范和独立验证证据；共享测试环境有并发干扰时，必须在无并发条件下串行复跑后再定性。
- **证据与实现同等重要**：完成定义要求的每条 Route、错误路径、权限边界、DTO 或不变量都必须有可定位测试证据；“测试全绿”不能替代缺失的验收矩阵。

### 三轮上限与固定验收线

- 单阶段默认最多三轮：实现审核、一次集中整改、最终复验。首轮必须按冻结规格一次列全验收矩阵；后续只复核既有要求，不得移动验收线。
- 只有生产规格偏差、数据/权限/安全风险、migration/schema 漂移、真实并发不变量缺失或必需质量门失败可以阻断。测试 helper 的极端故障注入、诊断完善、轻微重复或仅影响测试失败清理的问题，默认记录为非阻断技术债。
- 第三轮后仍出现问题时，先做验收线审计；除新发现的生产级高风险外，不再追加整改轮次。不得递归审核测试证据工具本身并据此阻断产品阶段。
- 新增阻断项必须直接引用冻结的 R-ID/AC-ID 或既有工程硬约束；审核中临时提出的改进不得升级为当轮完成定义。

### 放行与交接

- **Cursor 交付**：提交聚焦 commit，更新实施记录/验证矩阵/整改状态，并按指令固定格式回报；在 Codex 审核前只能声明“已交审核”。
- **NO-GO**：Codex 提交完整整改文档，并只下发该整改阶段指令。
- **GO**：Codex 直接提交阶段签署文档；若下一阶段属于 Cursor 业务实现，再提交唯一执行指令并发送简短启动 Prompt。若下一步只是归并、push、SHA 核对、归档或日志，Codex 直接执行并报告结果，不再转交 Cursor。
- 未覆盖的验证不得表述为通过；禁止将实现、整改、签署与下一阶段混在同一 Cursor 指令中。

### 分支、归并与提交基线

- 已签署里程碑先在其功能分支上完成最终审核，再由 Codex 默认以**仅快进**方式归并到本地 `main`，普通推送并确认 `origin/main` 与本地 `main` 指向同一完整 SHA；未经明确授权不得改写 `main` 历史或强推。
- 下一里程碑必须从该已同步的 `main` 新建独立 `feat/<milestone>` 分支；不得在上一里程碑分支、未归并 main 或含遗留差异的工作区启动下一阶段。
- Cursor 的每个实现提交必须聚焦一个获授权阶段，且交接报告固定包含：`branch`、完整 `HEAD` SHA、完整执行基线 SHA、已解决 R-ID/AC-ID、修改文件、原始验证命令摘要和 blocker。没有 Codex GO 不得把“已交审核”表述为完成。
- Codex 的规划、整改、签署和下一阶段指令必须先提交到当前任务分支；提交信息写明阶段和用途。任务 `task.json` 必须记录目标分支、`base_branch`、固定基线 SHA 与准确状态。
- 推送前先以 `git status --short --branch` 区分未提交文件与分支相对 main 的累计差异；界面显示的 diff 不是未提交的证明。推送后复核本地与远端完整 SHA；创建下一分支前不得留下未跟踪的上一任务文件。

## Trellis Workflow

For a substantial feature, a new task, or a resumed implementation task, first use the user-level `trellis-start` skill. Use its task workflow and generated specifications before writing code. For simple questions or trivial edits, use judgment and do not create a Trellis task unless requested.
