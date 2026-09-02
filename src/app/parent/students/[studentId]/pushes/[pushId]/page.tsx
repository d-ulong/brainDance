"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  createComment,
  deleteComment,
  deletePush,
  editComment,
  familyPushStatusLabel,
  getAnswer,
  getPush,
  listComments,
  transitionPush,
  type FamilyPushDto,
  type PushAnswerDto,
  type PushCommentDto,
} from "@/lib/client/m7-api";

export default function ParentPushDetailPage({
  params,
}: {
  params: Promise<{ studentId: string; pushId: string }>;
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [pushId, setPushId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<FamilyPushDto | null>(null);
  const [answer, setAnswer] = useState<PushAnswerDto | null>(null);
  const [comments, setComments] = useState<PushCommentDto[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      setStudentId(resolved.studentId);
      setPushId(resolved.pushId);
      try {
        await loadAll(resolved.studentId, resolved.pushId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll, params, router]);

  async function runAction(action: "publish" | "cancel" | "disable") {
    if (!studentId || !pushId) return;
    setError(null);
    try {
      await transitionPush(studentId, pushId, action);
      await loadAll(studentId, pushId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    }
  }

  async function onDelete() {
    if (!studentId || !pushId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError(null);
    try {
      await deletePush(studentId, pushId);
      router.replace(`/parent/students/${studentId}/pushes`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  async function onComment() {
    if (!studentId || !pushId || !commentBody.trim()) return;
    setError(null);
    try {
      await createComment(studentId, pushId, commentBody);
      setCommentBody("");
      await loadAll(studentId, pushId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "评论失败");
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
    <PageShell
      title="推送详情"
      backHref={studentId ? `/parent/students/${studentId}/pushes` : "/parent/students"}
      showLogout
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8">
        {error ? (
          <Alert tone="error" data-testid="push-detail-error">
            {error}
          </Alert>
        ) : null}

        {push ? (
          <article className="flex flex-col gap-2" data-testid="push-detail">
            <p className="text-xs text-neutral-500" data-testid="push-detail-status">
              {familyPushStatusLabel(push.status)}
              {push.canEdit ? " · 创建者" : " · 只读"}
            </p>
            <p className="whitespace-pre-wrap" data-testid="push-detail-body">
              {push.body || "(无正文)"}
            </p>
            {push.linkUrl ? (
              <a
                href={push.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-blue-700 underline"
                data-testid="push-detail-link"
              >
                {push.linkUrl}
              </a>
            ) : null}

            {push.canEdit ? (
              <div className="mt-2 flex flex-col gap-2">
                {push.status === "draft" || push.status === "scheduled" ? (
                  <button
                    type="button"
                    data-testid="push-publish"
                    className="min-h-11 rounded border border-neutral-300 px-3"
                    onClick={() => void runAction("publish")}
                  >
                    立即发布
                  </button>
                ) : null}
                {push.status === "scheduled" ? (
                  <button
                    type="button"
                    data-testid="push-cancel"
                    className="min-h-11 rounded border border-neutral-300 px-3"
                    onClick={() => void runAction("cancel")}
                  >
                    取消预约
                  </button>
                ) : null}
                {push.status === "published" ? (
                  <button
                    type="button"
                    data-testid="push-disable"
                    className="min-h-11 rounded border border-neutral-300 px-3"
                    onClick={() => void runAction("disable")}
                  >
                    停用
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="push-delete"
                  className="min-h-11 rounded border border-red-400 px-3 text-red-700"
                  onClick={() => void onDelete()}
                >
                  {confirmDelete ? "再次点击确认删除" : "删除推送"}
                </button>
              </div>
            ) : null}
          </article>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">学生作答</h2>
          {answer ? (
            <p className="whitespace-pre-wrap text-sm" data-testid="push-answer-body">
              {answer.body}
            </p>
          ) : (
            <p className="text-sm text-neutral-600" data-testid="push-answer-empty">
              暂无作答
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">评论</h2>
          <ul className="flex flex-col gap-2" data-testid="push-comment-list">
            {comments.map((comment) => (
              <li key={comment.commentId} className="rounded border border-neutral-200 p-2 text-sm">
                {comment.deleted ? (
                  <p data-testid={`comment-deleted-${comment.commentId}`}>评论已删除</p>
                ) : (
                  <p data-testid={`comment-body-${comment.commentId}`}>{comment.body}</p>
                )}
                {comment.canEdit && !comment.deleted ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="min-h-11 px-2 underline"
                      data-testid={`comment-edit-${comment.commentId}`}
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
                      className="min-h-11 px-2 underline"
                      data-testid={`comment-delete-${comment.commentId}`}
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
              <textarea
                data-testid="push-comment-input"
                className="min-h-20 rounded border border-neutral-300 px-3 py-2"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
              />
              <button
                type="button"
                data-testid="push-comment-submit"
                className="min-h-11 rounded bg-neutral-900 px-4 text-white"
                onClick={() => void onComment()}
              >
                发表评论
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
