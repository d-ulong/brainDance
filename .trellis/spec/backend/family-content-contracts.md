# Family Content Contracts

## Scenario: Push media ownership and presentation

- A push accepts 0–5 image references per student delivery. Route validation and `normalizePushContent` must enforce the same upper bound.
- Delivery versions remain the media authorization authority. A library detail projects one authorized delivery's current media once in the push-content region; per-student thread components must not duplicate those attachments.
- Editing an active published push appends a new delivery version. Existing media IDs may be referenced by that new version, replaced by newly uploaded per-student media, or explicitly cleared; earlier versions remain historical facts.
- Only direct video files and explicitly allow-listed providers are embedded. Unknown URLs stay external links and must never be placed in an arbitrary iframe.

## Scenario: Cross-delivery comment references

### 1. Scope / Trigger

Use this contract when one push-library publication creates a separate `family_pushes`
delivery per student while disclosed answers and comments form one shared conversation.

### 2. Signatures

- Read: `listPushComments(db, { actorId, actorRole, pushId }) -> PushCommentDto[]`
- Write: `createPushComment(db, { pushId, parentCommentId?, quotedAnswerId?, quotedCommentId?, ... })`
- DTO: `PushCommentDto.reference -> { kind, authorName, body } | null`

### 3. Contracts

- `parentCommentId`, `quotedCommentId`, and `quotedAnswerId` remain stable fact IDs.
- The service, not a page component, projects the visible target author and current
  excerpt into `reference`.
- For a student, both read and write resolve targets from the same publication's
  deliveries that are currently disclosed to that student. Parents retain their
  relationship-scoped access.
- A deleted target comment projects `评论已删除`; a textless image answer projects a
  non-sensitive fallback rather than a raw ID.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Target is in current or disclosed sibling delivery | Accept and return reference projection |
| Target belongs to a hidden sibling delivery | `NOT_FOUND` without leaking target data |
| Answer and comment quote are both supplied | `VALIDATION_ERROR` |
| Target comment was deleted before creation | `NOT_FOUND` |
| Existing target is deleted after creation | Fresh reads return the deleted fallback |

### 5. Good / Base / Bad Cases

- Good: student B replies to student A's disclosed answer and every detail page shows
  `引用作答 · A` plus the answer excerpt.
- Base: a comment without a reference returns `reference: null`.
- Bad: validate only against `comment.pushId`, or make each UI rediscover targets from
  its local arrays; both lose valid cross-delivery references.

### 6. Tests Required

- Unit: reference projection selects reply, quoted comment, and quoted answer labels.
- Integration: two students, one publication, separate deliveries; after disclosure B
  quotes A, creation succeeds, and a fresh `listPushComments` returns author/body.
- Privacy regression: before disclosure, the same target is neither readable nor writable.

### 7. Wrong vs Correct

```typescript
// Wrong: a page-local lookup cannot resolve a sibling delivery.
const target = currentDeliveryAnswers.find((answer) => answer.answerId === quotedAnswerId);

// Correct: render the authorized server projection; local lookup is only a legacy fallback.
const target = comment.reference;
```
