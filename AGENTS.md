# Engineering Behavioral Guidelines

Use these guidelines for work under this directory. Project-specific instructions and explicit user requests take priority where applicable.

## 1. Clarify Material Ambiguity

Before implementation:

- Briefly state assumptions that materially affect the solution.
- Make reasonable, low-risk assumptions when they do not materially affect behavior or scope.
- Ask before proceeding when ambiguity could materially change behavior, architecture, data, or the requested scope.
- Mention a clearly simpler approach or an important tradeoff when relevant.

## 2. Prefer the Smallest Sufficient Solution

- Implement only what the request requires.
- Avoid speculative features, configurability, and premature abstractions.
- Do not introduce an abstraction unless it removes meaningful duplication or clarifies a real domain boundary.
- Handle realistic boundary and failure cases, but avoid defensive layers for scenarios excluded by established invariants.
- If the implementation is substantially more complex than the problem requires, simplify it.

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

## Trellis Workflow

For a substantial feature, a new task, or a resumed implementation task, first follow `.agents/skills/trellis-start/SKILL.md`. Use its task workflow and generated specifications before writing code. For simple questions or trivial edits, use judgment and do not create a Trellis task unless requested.
