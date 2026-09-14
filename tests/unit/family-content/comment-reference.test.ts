import { describe, expect, it } from "vitest";

import { resolveCommentReference } from "@/components/family-content/comment-reference";
import type { PushAnswerDto, PushCommentDto } from "@/lib/client/m7-api";

const answers: PushAnswerDto[] = [
  {
    answerId: "answer-1",
    pushId: "push-1",
    studentId: "student-1",
    authorName: "小桥",
    currentVersion: 1,
    body: "我完成了第一题",
    media: [],
    createdAt: "2026-09-12T01:00:00.000Z",
    updatedAt: "2026-09-12T01:00:00.000Z",
  },
];

const comments: PushCommentDto[] = [
  {
    commentId: "comment-1",
    pushId: "push-1",
    authorId: "parent-1",
    authorName: "妈妈",
    parentCommentId: null,
    quotedAnswerId: null,
    quotedCommentId: null,
    currentVersion: 1,
    body: "思路很清楚",
    deleted: false,
    canEdit: false,
    createdAt: "2026-09-12T01:05:00.000Z",
    updatedAt: "2026-09-12T01:05:00.000Z",
  },
];

describe("comment reference display projection", () => {
  it("keeps the referenced author and body for a reply", () => {
    expect(
      resolveCommentReference(
        { ...comments[0]!, commentId: "comment-2", parentCommentId: "comment-1" },
        answers,
        comments,
      ),
    ).toEqual({ kind: "回复", authorName: "妈妈", body: "思路很清楚" });
  });

  it("keeps the referenced answer author and body", () => {
    expect(
      resolveCommentReference(
        { ...comments[0]!, commentId: "comment-2", quotedAnswerId: "answer-1" },
        answers,
        comments,
      ),
    ).toEqual({ kind: "引用作答", authorName: "小桥", body: "我完成了第一题" });
  });

  it("uses the server projection when the target belongs to a sibling delivery", () => {
    expect(
      resolveCommentReference(
        {
          ...comments[0]!,
          commentId: "comment-3",
          parentCommentId: "peer-comment",
          reference: {
            kind: "reply",
            authorName: "小溪",
            body: "这是另一个学生的公开评论",
          },
        },
        answers,
        comments,
      ),
    ).toEqual({ kind: "回复", authorName: "小溪", body: "这是另一个学生的公开评论" });
  });
});
