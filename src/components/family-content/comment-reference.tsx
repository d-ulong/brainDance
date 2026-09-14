import type { PushAnswerDto, PushCommentDto } from "@/lib/client/m7-api";

export type CommentReferenceProjection = {
  kind: "回复" | "引用评论" | "引用作答";
  authorName: string;
  body: string;
};

export function resolveCommentReference(
  comment: PushCommentDto,
  answers: PushAnswerDto[],
  comments: PushCommentDto[],
): CommentReferenceProjection | null {
  if (comment.reference) {
    return {
      kind:
        comment.reference.kind === "reply"
          ? "回复"
          : comment.reference.kind === "quoted_comment"
            ? "引用评论"
            : "引用作答",
      authorName: comment.reference.authorName,
      body: comment.reference.body,
    };
  }
  const commentId = comment.parentCommentId ?? comment.quotedCommentId;
  if (commentId) {
    const target = comments.find((candidate) => candidate.commentId === commentId);
    return {
      kind: comment.parentCommentId ? "回复" : "引用评论",
      authorName: target?.authorName ?? "原作者",
      body: target?.deleted ? "评论已删除" : target?.body ?? "原评论暂不可见",
    };
  }
  if (comment.quotedAnswerId) {
    const target = answers.find((answer) => answer.answerId === comment.quotedAnswerId);
    return {
      kind: "引用作答",
      authorName: target?.authorName ?? "原作者",
      body: target?.body || "图片作答或原作答暂不可见",
    };
  }
  return null;
}

export function CommentReference({
  comment,
  answers,
  comments,
}: {
  comment: PushCommentDto;
  answers: PushAnswerDto[];
  comments: PushCommentDto[];
}) {
  const reference = resolveCommentReference(comment, answers, comments);
  if (!reference) return null;
  return (
    <blockquote className="bd-comment-reference" data-testid={`comment-reference-${comment.commentId}`}>
      <span>{reference.kind} · {reference.authorName}</span>
      <p>{reference.body}</p>
    </blockquote>
  );
}
