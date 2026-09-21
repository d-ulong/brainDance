# Assertion closure review — e15fbbc

## Decision

**NO-GO for push.** Production behavior, authorization, DTOs, layout implementation, dual-project execution and evidence hashes are accepted. Only deterministic assertions in `tests/e2e/ui-goals-training-polish.spec.ts` remain incomplete.

## Remaining blockers

1. **E01:** Day and week views do not call the document-overflow assertion; only month does. The internal-scroller assertion counts a node but does not verify the visible calendar owns the intended overflow behavior.
2. **E03 / clock:** `expected.hour` is calculated but never compared with the displayed hour. An incorrect whole-hour timezone can pass.
3. **E03 / review rows:** Reaction is sufficiently concrete, but Stroop and digit-span assertions mainly check labels. They do not compare the deterministic seeded actual value, expected value and correctness value.
4. **E04:** Student and parent training screenshots use `page.screenshot` directly. Their theme assertion is not immediately adjacent to the capture.
5. **E05:** Some post-reload or post-theme-switch goal captures do not re-assert both the expected state class and exact status text before capture.

## Accepted evidence

- Both Playwright projects ran: 28 desktop + 28 mobile.
- All 19 candy/space pairs exist and have different SHA-256 hashes.
- Owned evidence cleanup, 360/768/1440 schedule captures, numeric contrast, modal focus wrapping/restoration and plan dead-code removal are complete.
- Independent `pnpm typecheck`, `pnpm lint`, focused Prettier and fixed-diff whitespace checks passed.

