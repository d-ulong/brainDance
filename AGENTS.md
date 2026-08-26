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

本项目采用「Codex 设计与审核、Cursor 实现」的固定分工；仓库内的任务文档是双方唯一的事实来源。

### 角色边界

- **Codex**：澄清需求、维护 PRD/设计/实施/验收与整改文档，启动任务，审查实现与验证结果，给出 GO/NO-GO 结论；除协作文档、签署记录和必要的流程配置外，不代替 Cursor 编写 M2 业务代码。
- **Cursor**：仅在已 `in_progress` 的任务、指定分支和明确范围内实现代码、迁移和测试；不自行改变 PRD/设计决策，不扩大范围，不启动未获批准的任务。
- **共同**：每次交接均以 Git SHA 和任务目录定位；聊天内容仅作通知，不能取代仓库文档或提交。

### Codex → Cursor：实现或整改指令

Codex 给 Cursor 的每个 prompt 必须可直接执行，且包含：

1. `Active task` 的绝对/仓库相对任务路径、目标分支与基线；
2. 唯一必读文档及精确章节 / R-ID / checklist ID；
3. 允许修改的范围、明确禁止项和完成定义；
4. 必须运行的验证命令；
5. 要求 Cursor 提交，并以「SHA、修改文件、命令与原始结果、未解决 blocker」的固定格式回报。

若是整改，Codex 必须先把全部可执行发现写入任务目录的规范整改文档；每项采用稳定 ID，写明文件、章节、原因、修订动作和验证方式。不得仅在聊天中给出发现，也不得要求 Cursor 猜测隐含问题。

### Cursor → Codex：实现交接

Cursor 完成一轮实现后，必须：

1. 提交聚焦的 Git commit，不夹带无关改动；
2. 在任务目录更新实施记录、验证矩阵或整改项状态（如任务文档要求）；
3. 回报完整 SHA、变更摘要、已执行命令及其结果、未执行项及原因；
4. 在 Codex 给出审查结论前，不宣称任务已放行或归并。

### Codex 审核与回合控制

- 审核以已提交 SHA 为固定基线，分别核对规格、工程规范和验证证据。
- **NO-GO** 时，Codex 必须将一次审核中发现的全部阻断项写入规范整改文档，并以 `R-ID` 或 checklist ID 标识；同一事实不得拆成多轮让 Cursor 盲修。
- **GO** 时，Codex 输出精炼的下一步 prompt（例如质量复验、归并或下一里程碑），明确该结论的范围；未覆盖的验证不得被表述为通过。
- 每个 prompt 只要求一个可验证阶段：实现、整改、复验或归并，不混合多个阶段。

## Trellis Workflow

For a substantial feature, a new task, or a resumed implementation task, first use the user-level `trellis-start` skill. Use its task workflow and generated specifications before writing code. For simple questions or trivial edits, use judgment and do not create a Trellis task unless requested.
