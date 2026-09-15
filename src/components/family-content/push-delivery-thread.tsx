"use client";

import { useCallback, useEffect, useState } from "react";

import { LoadingState, PrimaryButton, SecondaryButton } from "@/components/ui/page-shell";
import { MediaPreviewList } from "@/components/family-content/media-preview";
import { ThreadedComments } from "@/components/family-content/threaded-comments";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { ApiError } from "@/lib/client/api";
import {
  createComment,
  deleteComment,
  editComment,
  getAnswer,
  getPush,
  listComments,
  type PushAnswerDto,
  type PushCommentDto,
} from "@/lib/client/m7-api";

type PushDeliveryThreadProps = {
  studentId: string;
  pushId: string;
  studentName: string;
  onError: (message: string) => void;
};

/** Read and comment on one student's delivery without navigating away from the push library. */
export function PushDeliveryThread({ studentId, pushId, studentName, onError }: PushDeliveryThreadProps) {
  const [answers, setAnswers] = useState<PushAnswerDto[]>([]);
  const [comments, setComments] = useState<PushCommentDto[]>([]);
  const [body, setBody] = useState("");
  const [quote, setQuote] = useState<{ answerId?: string; parentCommentId?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [, setError] = useState<string | null>(null);
  const [commentable, setCommentable] = useState(false);
  const [editingComment, setEditingComment] = useState<PushCommentDto | null>(null);
  const [editBody, setEditBody] = useState("");
  const [deletingComment, setDeletingComment] = useState<PushCommentDto | null>(null);

  const load = useCallback(async () => {
    const [pushResult, answerResult, commentResult] = await Promise.all([
      getPush(studentId, pushId),
      getAnswer(studentId, pushId),
      listComments(studentId, pushId),
    ]);
    setAnswers(answerResult.answers);
    setComments(commentResult.comments);
    setCommentable(pushResult.status === "published");
  }, [pushId, studentId]);

  useEffect(() => {
    void load()
      .catch((cause) => {
        const message = cause instanceof ApiError ? cause.message : "无法加载作答与评论";
        setError(message);
        onError(message);
      })
      .finally(() => setLoading(false));
  }, [load, onError]);

  async function submitComment() {
    if (!body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createComment(
        studentId,
        pushId,
        body.trim(),
        quote?.parentCommentId ?? null,
        quote?.answerId ? { answerId: quote.answerId } : undefined,
      );
      setBody("");
      setQuote(null);
      await load();
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "发表评论失败";
      setError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`bd-push-thread ${answers.length ? "bd-push-thread-answered" : "bd-push-thread-unanswered"}`} data-testid={`push-thread-${pushId}`}>
      <div className="bd-push-thread-heading"><span aria-hidden="true">{answers.length ? "✅" : "🙂"}</span><h3>{studentName}</h3><span className="bd-answer-status">{answers.length ? "已作答" : "待作答"} · {answers.length} 次作答 · {comments.length} 条评论</span></div>
      {loading ? <LoadingState label="加载作答与评论…" /> : (
        <div className="mt-3 space-y-3 text-sm">
          <div className="bd-thread-section bd-thread-answers">
            <h4>作答记录</h4>
            {answers.length ? <ul className="mt-2 space-y-2">
              {answers.map((answer, index) => <li key={answer.answerId} className="bd-social-post">
                <div className="bd-social-avatar" aria-hidden="true">{answer.authorName.slice(0, 1) || "🙂"}</div><div className="bd-social-post-main"><p className="bd-social-meta"><strong>{answer.authorName}</strong><time>{new Date(answer.createdAt).toLocaleString("zh-CN")}</time></p>
                <p className="whitespace-pre-wrap">{answer.body}</p>
                {answer.media?.length ? <MediaPreviewList studentId={studentId} media={answer.media} testIdPrefix={`push-answer-${answer.answerId}`} /> : null}
                <div className="bd-social-post-actions"><span>第 {index + 1} 次作答</span><button type="button" onClick={() => setQuote({ answerId: answer.answerId })}>引用作答</button></div></div>
              </li>)}
            </ul> : <p className="mt-1 text-neutral-600">暂未作答</p>}
          </div>
          <div className="bd-thread-section bd-thread-comments">
            <h4>评论讨论</h4>
            <ThreadedComments comments={comments} answers={answers} onReply={(comment) => setQuote({ parentCommentId: comment.commentId })} onEdit={(comment) => { setEditingComment(comment); setEditBody(comment.body ?? ""); }} onDelete={setDeletingComment} />
          </div>
          {commentable ? <>
          {quote ? <p className="text-xs text-neutral-600">正在{quote.answerId ? "引用作答" : "回复评论"} <button type="button" className="underline" onClick={() => setQuote(null)}>取消</button></p> : null}
          <label className="flex flex-col gap-1 font-medium">发表评论
            <textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-20 rounded-xl border border-neutral-300 bg-white p-2 font-normal" />
          </label>
          <PrimaryButton type="button" disabled={saving || !body.trim()} onClick={() => void submitComment()}>
            {saving ? "发表中…" : "发表评论"}
          </PrimaryButton>
          </> : <p className="text-sm text-neutral-600">该投递当前未发布，暂不能评论。</p>}
        </div>
      )}
      {editingComment ? <Modal title="编辑评论" onClose={() => setEditingComment(null)} layer="critical"><textarea className="min-h-28 w-full rounded-2xl border p-3" value={editBody} onChange={(event) => setEditBody(event.target.value)} /><div className="mt-4 flex justify-end gap-2"><SecondaryButton onClick={() => setEditingComment(null)}>取消</SecondaryButton><PrimaryButton disabled={!editBody.trim()} onClick={() => void editComment(studentId, pushId, editingComment.commentId, editBody.trim()).then(() => { setEditingComment(null); return load(); }).catch((cause) => onError(cause instanceof ApiError ? cause.message : "编辑失败"))}>保存</PrimaryButton></div></Modal> : null}
      {deletingComment ? <ConfirmDialog title="删除评论" message="确定删除这条评论吗？回复关系会保留，但正文将显示为已删除。" confirmLabel="删除" tone="danger" onClose={() => setDeletingComment(null)} onConfirm={() => void deleteComment(studentId, pushId, deletingComment.commentId).then(() => { setDeletingComment(null); return load(); }).catch((cause) => onError(cause instanceof ApiError ? cause.message : "删除失败"))} /> : null}
    </section>
  );
}
