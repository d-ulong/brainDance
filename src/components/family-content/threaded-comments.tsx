"use client";

import { CommentReference } from "@/components/family-content/comment-reference";
import type { PushAnswerDto, PushCommentDto } from "@/lib/client/m7-api";

export function ThreadedComments({ comments, answers, onReply, onEdit, onDelete }: {
  comments: PushCommentDto[];
  answers: PushAnswerDto[];
  onReply: (comment: PushCommentDto) => void;
  onEdit?: (comment: PushCommentDto) => void;
  onDelete?: (comment: PushCommentDto) => void;
}) {
  const children = new Map<string, PushCommentDto[]>();
  for (const comment of comments) if (comment.parentCommentId) children.set(comment.parentCommentId, [...(children.get(comment.parentCommentId) ?? []), comment]);
  const ids = new Set(comments.map((comment) => comment.commentId));
  const roots = comments.filter((comment) => !comment.parentCommentId || !ids.has(comment.parentCommentId));

  function render(comment: PushCommentDto, depth: number, visited: Set<string>): React.ReactNode {
    if (visited.has(comment.commentId)) return null;
    const nextVisited = new Set(visited).add(comment.commentId);
    return <li key={comment.commentId} className="bd-social-comment" style={{ "--thread-depth": Math.min(depth, 3) } as React.CSSProperties}>
      <div className="bd-social-avatar" aria-hidden="true">{comment.authorName.slice(0, 1) || "🙂"}</div>
      <div className="bd-social-comment-main">
        <div className="bd-social-meta"><strong>{comment.authorName}</strong><time>{new Date(comment.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time></div>
        <CommentReference comment={comment} answers={answers} comments={comments} />
        <p className={comment.deleted ? "text-neutral-400" : ""}>{comment.deleted ? "评论已删除" : comment.body}</p>
        {!comment.deleted ? <div className="bd-comment-actions"><button type="button" onClick={() => onReply(comment)}>回复</button>{comment.canEdit && onEdit ? <button type="button" onClick={() => onEdit(comment)}>编辑</button> : null}{comment.canEdit && onDelete ? <button type="button" onClick={() => onDelete(comment)}>删除</button> : null}</div> : null}
        {(children.get(comment.commentId)?.length ?? 0) > 0 ? <ul className="bd-social-replies">{children.get(comment.commentId)!.map((child) => render(child, depth + 1, nextVisited))}</ul> : null}
      </div>
    </li>;
  }

  return roots.length ? <ul className="bd-social-comments">{roots.map((comment) => render(comment, 0, new Set()))}</ul> : <p className="bd-empty-inline">还没有评论，来聊聊吧。</p>;
}
