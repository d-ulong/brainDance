"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { LoadingState, PageShell, PrimaryButton, SecondaryButton } from "@/components/ui/page-shell";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { MediaPreviewList } from "@/components/family-content/media-preview";
import { ThreadedComments } from "@/components/family-content/threaded-comments";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  createComment,
  deleteComment,
  editAnswer,
  editComment,
  familyPushStatusLabel,
  getAnswer,
  getPush,
  listComments,
  submitAnswer,
  uploadMedia,
  type FamilyPushDto,
  type PushAnswerDto,
  type PushCommentDto,
} from "@/lib/client/m7-api";

export default function StudentPushDetailPage({ params }: { params: Promise<{ pushId: string }> }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [pushId, setPushId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<FamilyPushDto | null>(null);
  const [answers, setAnswers] = useState<PushAnswerDto[]>([]);
  const [comments, setComments] = useState<PushCommentDto[]>([]);
  const [answerBody, setAnswerBody] = useState("");
  const [answerImage, setAnswerImage] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [quoteAnswerId, setQuoteAnswerId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<PushCommentDto | null>(null);
  const [editBody, setEditBody] = useState("");
  const [deletingComment, setDeletingComment] = useState<PushCommentDto | null>(null);
  const [editingAnswer, setEditingAnswer] = useState<PushAnswerDto | null>(null);
  const [editAnswerBody, setEditAnswerBody] = useState("");
  const [editAnswerImage, setEditAnswerImage] = useState<File | null>(null);
  const [editUploadStatus, setEditUploadStatus] = useState<string | null>(null);

  const loadAll = useCallback(async (sid: string, pid: string) => {
    const [pushData, answerData, commentData] = await Promise.all([
      getPush(sid, pid),
      getAnswer(sid, pid),
      listComments(sid, pid),
    ]);
    setPush(pushData);
    setAnswers(answerData.answers);
    setComments(commentData.comments);
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      const session = await fetchSession();
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      setStudentId(session.userId);
      setPushId(resolved.pushId);
      try {
        await loadAll(session.userId, resolved.pushId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll, params, router]);

  const ownAnswers = studentId
    ? answers.filter((item) => item.studentId === studentId)
    : [];
  const showAnswerForm = push?.status === "published";

  async function uploadOptionalImage(file: File | null, setStatus: (value: string | null) => void) {
    if (!studentId || !file) return [] as string[];
    setStatus("uploading");
    const mime = file.type === "image/jpg" ? "image/jpeg" : file.type || "image/jpeg";
    const uploaded = await uploadMedia(studentId, file, mime);
    if (uploaded.status !== "ready") {
      setStatus("failed");
      throw new Error("图片处理未完成");
    }
    setStatus("ready");
    return [uploaded.mediaId];
  }

  async function onSubmitAnswer() {
    if (!studentId || !pushId) return;
    if (!answerBody.trim() && !answerImage) return;
    setError(null);
    setUploadStatus(null);
    try {
      const mediaIds = await uploadOptionalImage(answerImage, setUploadStatus);
      await submitAnswer(studentId, pushId, {
        body: answerBody || undefined,
        mediaIds: mediaIds.length ? mediaIds : undefined,
      });
      setAnswerBody("");
      setAnswerImage(null);
      setUploadStatus(null);
      await loadAll(studentId, pushId);
    } catch (err) {
      setUploadStatus((prev) => (prev === "uploading" ? "failed" : prev));
      setError(err instanceof ApiError ? err.message : "提交作答失败");
    }
  }

  async function onSaveEditedAnswer() {
    if (!studentId || !pushId || !editingAnswer) return;
    if (!editAnswerBody.trim() && !editAnswerImage) return;
    setError(null);
    setEditUploadStatus(null);
    try {
      const mediaIds = await uploadOptionalImage(editAnswerImage, setEditUploadStatus);
      await editAnswer(studentId, pushId, editingAnswer.answerId, {
        body: editAnswerBody || undefined,
        mediaIds: mediaIds.length ? mediaIds : undefined,
      });
      setEditingAnswer(null);
      setEditAnswerBody("");
      setEditAnswerImage(null);
      setEditUploadStatus(null);
      await loadAll(studentId, pushId);
    } catch (err) {
      setEditUploadStatus((prev) => (prev === "uploading" ? "failed" : prev));
      setError(err instanceof ApiError ? err.message : "保存作答失败");
    }
  }

  async function onComment() {
    if (!studentId || !pushId || !commentBody.trim()) return;
    setError(null);
    try {
      await createComment(
        studentId,
        pushId,
        commentBody,
        replyTo,
        quoteAnswerId ? { answerId: quoteAnswerId } : undefined,
      );
      setCommentBody("");
      setReplyTo(null);
      setQuoteAnswerId(null);
      await loadAll(studentId, pushId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "回复失败");
    }
  }

  if (loading) {
    return (
      <PageShell title="推送详情">
        <LoadingState label="加载中…" />
      </PageShell>
    );
  }

  return (
    <PageShell title="推送详情" backHref="/student/pushes" showLogout hideHeading>
      <div className="bd-push-detail">
        <ErrorDialog message={error} onClose={() => setError(null)} />

        {push ? (
          <article className="bd-push-hero" data-testid="student-push-detail">
            <div className="bd-push-hero-meta"><span>💌 家庭推送</span><span>{familyPushStatusLabel(push.status)}</span></div>
            <p className="bd-push-hero-body" data-testid="student-push-body">
              {push.body || "(无正文)"}
            </p>
            {push.linkUrl ? (
              <a
                href={push.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-blue-700 underline"
                data-testid="student-push-link"
              >
                {push.linkUrl}
              </a>
            ) : null}
            {studentId && push.media?.length ? (
              <MediaPreviewList
                studentId={studentId}
                media={push.media}
                testIdPrefix="student-push-media"
              />
            ) : null}
          </article>
        ) : null}

        <section className="bd-push-section">
          <div className="bd-section-heading">
            <h2>✍️ 我的作答</h2>
            <span className="bd-caption">可提交多次不同解法；每条作答创建后 10 天内可单独编辑，编辑后标识「已编辑」</span>
          </div>
          {ownAnswers.length ? (
            <ol className="space-y-3" data-testid="student-answer-current">
              {ownAnswers.map((item, index) => (
                <li className="bd-answer-card" key={item.answerId}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
                    <div className="flex items-center gap-2">
                      <strong className="text-neutral-700">第 {index + 1} 次作答</strong>
                      {item.edited ? (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900"
                          data-testid={`student-answer-edited-${item.answerId}`}
                        >
                          已编辑
                        </span>
                      ) : null}
                    </div>
                    <time>{new Date(item.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{item.body || "(图片作答)"}</p>
                  {studentId && item.media?.length ? (
                    <MediaPreviewList studentId={studentId} media={item.media} testIdPrefix={`student-answer-media-${item.answerId}`} />
                  ) : null}
                  {item.canEdit ? (
                    <button
                      type="button"
                      data-testid={`student-answer-edit-${item.answerId}`}
                      className="mt-3 min-h-11 font-bold text-[var(--bd-primary)]"
                      onClick={() => {
                        setEditingAnswer(item);
                        setEditAnswerBody(item.body ?? "");
                        setEditAnswerImage(null);
                        setEditUploadStatus(null);
                      }}
                    >
                      编辑这条作答
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-neutral-600">尚未作答</p>
          )}
          {showAnswerForm ? (
            <div className="mt-4 space-y-3 rounded-3xl border border-[var(--bd-border)] bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">提交新的解法</p>
              <textarea
                data-testid="student-answer-input"
                className="min-h-56 w-full rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface-soft)] px-4 py-3 text-base leading-relaxed"
                value={answerBody}
                onChange={(e) => setAnswerBody(e.target.value)}
                placeholder="写下你的解法、步骤或心得（可多次提交不同解法）"
              />
              <label className="flex flex-col gap-1 text-sm">
                图片作答（可选）
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  data-testid="student-answer-image-input"
                  className="min-h-11 text-sm"
                  onChange={(e) => setAnswerImage(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                disabled
                title="手写画布将在后续版本开放"
                className="min-h-11 rounded border border-dashed border-neutral-300 bg-neutral-100 px-3 text-left text-sm text-neutral-500"
                data-testid="student-handwriting-unavailable"
              >
                手写画布（功能待开放）
              </button>
              {uploadStatus ? (
                <p className="text-sm text-neutral-600" data-testid="student-answer-upload-status">
                  {uploadStatus === "uploading"
                    ? "图片处理中…"
                    : uploadStatus === "ready"
                      ? "图片已就绪"
                      : "图片处理失败，可重试"}
                </p>
              ) : null}
              <button
                type="button"
                data-testid="student-answer-submit"
                className="bd-primary min-h-11 rounded-full px-5 font-bold text-white"
                onClick={() => void onSubmitAnswer()}
              >
                提交新作答
              </button>
            </div>
          ) : (
            <p className="text-sm text-neutral-600" data-testid="student-answer-closed">
              当前状态不可作答
            </p>
          )}
        </section>

        {answers.some((item) => item.studentId !== studentId) ? (
          <section className="bd-push-section" data-testid="student-peer-answers">
            <div className="bd-section-heading"><h2>🌱 伙伴作答</h2><span className="bd-caption">公开后可以相互交流</span></div>
            <ul className="flex flex-col gap-2">
              {answers.filter((item) => item.studentId !== studentId).map((item) => (
                <li key={item.answerId} className="rounded-xl border border-neutral-200 p-3 text-sm">
                  <p className="font-semibold">
                    {item.authorName}
                    {item.edited ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        已编辑
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{item.body || "(图片作答)"}</p>
                  <button type="button" className="mt-2 min-h-9 font-bold text-[var(--bd-primary)]" onClick={() => { setQuoteAnswerId(item.answerId); setReplyTo(null); }}>引用作答</button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="bd-push-section">
          <div className="bd-section-heading"><h2>💬 讨论区</h2><span className="bd-caption">{comments.length} 条评论</span></div>
          <div data-testid="student-comment-list"><ThreadedComments comments={comments} answers={answers} onReply={(comment) => { setReplyTo(comment.commentId); setQuoteAnswerId(null); }} onEdit={(comment) => { setEditingComment(comment); setEditBody(comment.body ?? ""); }} onDelete={setDeletingComment} /></div>
          {push?.status === "published" ? (
            <div className="flex flex-col gap-2">
              {replyTo ? (
                <div className="bd-comment-reference" data-testid="student-reply-target">
                  <span>正在回复 · {comments.find((item) => item.commentId === replyTo)?.authorName ?? "成员"}</span>
                  <p>{comments.find((item) => item.commentId === replyTo)?.body ?? "原评论"}</p>
                  <button type="button" onClick={() => setReplyTo(null)}>取消回复</button>
                </div>
              ) : quoteAnswerId ? <div className="bd-comment-reference" data-testid="student-reply-target"><span>正在引用作答 · {answers.find((item) => item.answerId === quoteAnswerId)?.authorName ?? "成员"}</span><p>{answers.find((item) => item.answerId === quoteAnswerId)?.body || "图片作答"}</p><button type="button" onClick={() => setQuoteAnswerId(null)}>取消引用</button></div> : null}
              <textarea
                data-testid="student-comment-input"
                className="min-h-36 rounded-2xl border border-[var(--bd-border)] bg-white px-4 py-3 text-base leading-relaxed"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
              />
              <button
                type="button"
                data-testid="student-comment-submit"
                className="bd-primary min-h-11 rounded-full px-5 font-bold text-white"
                onClick={() => void onComment()}
              >
                {replyTo ? "提交回复" : quoteAnswerId ? "提交引用评论" : "发表评论"}
              </button>
            </div>
          ) : null}
        </section>

        {editingAnswer && studentId && pushId ? (
          <Modal
            title="编辑作答"
            onClose={() => {
              setEditingAnswer(null);
              setEditAnswerBody("");
              setEditAnswerImage(null);
              setEditUploadStatus(null);
            }}
            layer="critical"
          >
            <textarea
              data-testid="student-answer-edit-input"
              className="min-h-56 w-full rounded-2xl border border-[var(--bd-border)] bg-[var(--bd-surface-soft)] px-4 py-3 text-base leading-relaxed"
              value={editAnswerBody}
              onChange={(event) => setEditAnswerBody(event.target.value)}
            />
            <label className="mt-3 flex flex-col gap-1 text-sm">
              替换图片（可选）
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                data-testid="student-answer-edit-image-input"
                className="min-h-11 text-sm"
                onChange={(e) => setEditAnswerImage(e.target.files?.[0] ?? null)}
              />
            </label>
            {editUploadStatus ? (
              <p className="mt-2 text-sm text-neutral-600">
                {editUploadStatus === "uploading"
                  ? "图片处理中…"
                  : editUploadStatus === "ready"
                    ? "图片已就绪"
                    : "图片处理失败，可重试"}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <SecondaryButton
                onClick={() => {
                  setEditingAnswer(null);
                  setEditAnswerBody("");
                  setEditAnswerImage(null);
                  setEditUploadStatus(null);
                }}
              >
                取消
              </SecondaryButton>
              <PrimaryButton
                data-testid="student-answer-edit-save"
                disabled={!editAnswerBody.trim() && !editAnswerImage}
                onClick={() => void onSaveEditedAnswer()}
              >
                保存编辑
              </PrimaryButton>
            </div>
          </Modal>
        ) : null}

        {editingComment && studentId && pushId ? <Modal title="编辑评论" onClose={() => setEditingComment(null)} layer="critical"><textarea className="min-h-36 w-full rounded-2xl border p-3" value={editBody} onChange={(event) => setEditBody(event.target.value)} /><div className="mt-4 flex justify-end gap-2"><SecondaryButton onClick={() => setEditingComment(null)}>取消</SecondaryButton><PrimaryButton disabled={!editBody.trim()} onClick={() => void editComment(studentId, pushId, editingComment.commentId, editBody.trim()).then(() => { setEditingComment(null); return loadAll(studentId, pushId); }).catch((err) => setError(err instanceof ApiError ? err.message : "编辑失败"))}>保存</PrimaryButton></div></Modal> : null}
        {deletingComment && studentId && pushId ? <ConfirmDialog title="删除评论" message="确定删除这条评论吗？回复关系会保留，但正文将显示为已删除。" confirmLabel="删除" tone="danger" onClose={() => setDeletingComment(null)} onConfirm={() => void deleteComment(studentId, pushId, deletingComment.commentId).then(() => { setDeletingComment(null); return loadAll(studentId, pushId); }).catch((err) => setError(err instanceof ApiError ? err.message : "删除失败"))} /> : null}
      </div>
    </PageShell>
  );
}
