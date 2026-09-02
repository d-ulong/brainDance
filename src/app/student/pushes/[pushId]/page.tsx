"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  createComment,
  deleteComment,
  editComment,
  familyPushStatusLabel,
  getAnswer,
  getPush,
  listComments,
  submitAnswer,
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
  const [answer, setAnswer] = useState<PushAnswerDto | null>(null);
  const [comments, setComments] = useState<PushCommentDto[]>([]);
  const [answerBody, setAnswerBody] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const loadAll = useCallback(async (sid: string, pid: string) => {
    const [pushData, answerData, commentData] = await Promise.all([
      getPush(sid, pid),
      getAnswer(sid, pid),
      listComments(sid, pid),
    ]);
    setPush(pushData);
    setAnswer(answerData.answer);
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

  async function onSubmitAnswer() {
    if (!studentId || !pushId || !answerBody.trim()) return;
    setError(null);
    try {
      await submitAnswer(studentId, pushId, answerBody);
      setAnswerBody("");
      await loadAll(studentId, pushId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交作答失败");
    }
  }

  async function onComment() {
    if (!studentId || !pushId || !commentBody.trim()) return;
    setError(null);
    try {
      await createComment(studentId, pushId, commentBody, replyTo);
      setCommentBody("");
      setReplyTo(null);
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
    <PageShell title="推送详情" backHref="/student/pushes" showLogout>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8">
        {error ? (
          <Alert tone="error" data-testid="student-push-detail-error">
            {error}
          </Alert>
        ) : null}

        {push ? (
          <article className="flex flex-col gap-2" data-testid="student-push-detail">
            <p className="text-xs text-neutral-500">{familyPushStatusLabel(push.status)}</p>
            <p className="whitespace-pre-wrap" data-testid="student-push-body">
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
          </article>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">我的作答</h2>
          {answer ? (
            <p className="whitespace-pre-wrap text-sm" data-testid="student-answer-current">
              当前版本 v{answer.currentVersion}：{answer.body}
            </p>
          ) : (
            <p className="text-sm text-neutral-600">尚未作答</p>
          )}
          {push?.status === "published" ? (
            <>
              <textarea
                data-testid="student-answer-input"
                className="min-h-24 rounded border border-neutral-300 px-3 py-2"
                value={answerBody}
                onChange={(e) => setAnswerBody(e.target.value)}
                placeholder={answer ? "补充新版本作答" : "提交作答"}
              />
              <button
                type="button"
                data-testid="student-answer-submit"
                className="min-h-11 rounded bg-neutral-900 px-4 text-white"
                onClick={() => void onSubmitAnswer()}
              >
                提交作答
              </button>
            </>
          ) : (
            <p className="text-sm text-neutral-600" data-testid="student-answer-closed">
              当前状态不可作答
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">评论</h2>
          <ul className="flex flex-col gap-2" data-testid="student-comment-list">
            {comments.map((comment) => (
              <li key={comment.commentId} className="rounded border border-neutral-200 p-2 text-sm">
                {comment.deleted ? (
                  <p>评论已删除</p>
                ) : (
                  <>
                    <p data-testid={`student-comment-body-${comment.commentId}`}>{comment.body}</p>
                    <button
                      type="button"
                      className="mt-1 min-h-11 underline"
                      data-testid={`student-comment-reply-${comment.commentId}`}
                      onClick={() => setReplyTo(comment.commentId)}
                    >
                      回复
                    </button>
                  </>
                )}
                {comment.canEdit && !comment.deleted ? (
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className="min-h-11 underline"
                      onClick={() => {
                        const next = window.prompt("编辑评论", comment.body ?? "");
                        if (next && studentId && pushId) {
                          void editComment(studentId, pushId, comment.commentId, next)
                            .then(() => loadAll(studentId, pushId))
                            .catch((err) =>
                              setError(err instanceof ApiError ? err.message : "编辑失败"),
                            );
                        }
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="min-h-11 underline"
                      onClick={() => {
                        if (!studentId || !pushId) return;
                        void deleteComment(studentId, pushId, comment.commentId)
                          .then(() => loadAll(studentId, pushId))
                          .catch((err) =>
                            setError(err instanceof ApiError ? err.message : "删除失败"),
                          );
                      }}
                    >
                      删除
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {push?.status === "published" ? (
            <div className="flex flex-col gap-2">
              {replyTo ? (
                <p className="text-xs text-neutral-500" data-testid="student-reply-target">
                  回复评论 {replyTo.slice(0, 8)}…
                </p>
              ) : null}
              <textarea
                data-testid="student-comment-input"
                className="min-h-20 rounded border border-neutral-300 px-3 py-2"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
              />
              <button
                type="button"
                data-testid="student-comment-submit"
                className="min-h-11 rounded bg-neutral-900 px-4 text-white"
                onClick={() => void onComment()}
              >
                {replyTo ? "提交回复" : "发表评论"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
