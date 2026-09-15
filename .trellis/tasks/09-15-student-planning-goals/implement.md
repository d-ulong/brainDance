# Implementation Plan — Student planning and goals experience

## Ordered work

1. Add and test the goal schema migration, typed goal horizon and immutable gift-redemption fact/service/route/DTO, including authorization, validation, idempotency, audit and outbox semantics.
2. Extend typed plan entries and client DTOs with the optional 500-character item description; expose snapshot descriptions to schedule consumers and generated dates to library cards.
3. Add the pure date-range compaction helper and targeted unit tests for continuous, disjoint, singleton, empty and truncated/expanded presentation inputs.
4. Update parent/student goal forms and grouped cards; add the responsible-parent redemption action and the unredeemed/redeemed states.
5. Update parent/student plan forms, cards and schedule display; render generated date ranges per relevant student and item descriptions.
6. Replace student page tabs/overview with the collapsible unified workspace and preserve task completion actions/calendar behavior.
7. Correct parent personal navigation versus student-management tabs, and render answer images through the shared protected media-preview component.
8. Add focused integration, route/component and E2E coverage for the data and authorization paths; run focused checks before final quality review.

## Validation matrix

| Area | Evidence |
| --- | --- |
| Goal horizon/redemption | Migration/schema checks; service integration proves responsible-parent-only, success-and-gift preconditions, idempotent single fact, audit/outbox and DTO projection. |
| Plan content/generated dates | Plan-definition unit tests; library integration proves description snapshot round-trip and distinct generated-date projection; formatter unit tests. |
| Student workspace | Component/E2E proves no tabs/overview, balance and today/completed task details, green completed state, collapsed sections and completion flow. |
| Parent navigation/media | UI/E2E proves self pages omit student tabs and parent answer image resolves through capability; privacy test confirms denied media remains denied. |

## Focused commands

- Relevant unit and integration suites under `tests/unit/schedule`, `tests/integration/schedule`, `tests/integration/goals`, and `tests/integration/family-content`.
- Targeted Playwright specs for student plans, parent plans/goals, and family push media.
- Typecheck/lint only if focused changes or project scripts make it practical; expand validation only if focused evidence exposes cross-module risk.

## Rollback points

- Before applying the migration, review generated SQL constraints and the isolated test database target.
- If UI work reveals an incompatible existing consumer, preserve nullable/backward-compatible DTOs and repair that consumer before proceeding.
- No destructive schema/data operation is authorized.
