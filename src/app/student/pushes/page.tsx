"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { LoadingState, PageShell } from "@/components/ui/page-shell";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { ApiError, fetchSession } from "@/lib/client/api";
import { familyPushStatusLabel, listStudentPushes, type FamilyPushDto } from "@/lib/client/m7-api";

export default function StudentPushesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushes, setPushes] = useState<FamilyPushDto[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await listStudentPushes();
    setPushes(data.pushes);
  }, []);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      setStudentId(session.userId);
      try {
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载推送失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [load, router]);

  if (loading) {
    return (
      <PageShell title="家庭推送">
        <LoadingState label="加载中…" />
      </PageShell>
    );
  }

  return (
    <PageShell title="家庭推送" backHref="/" showLogout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-8">
        <ErrorDialog message={error} onClose={() => setError(null)} />
        {pushes.length === 0 ? (
          <p className="text-sm text-neutral-600" data-testid="student-push-empty">
            暂无已发布推送
          </p>
        ) : (
          <ul className="bd-push-library-grid" data-testid="student-push-list">
            {pushes.map((push) => {
              const answered = Boolean(push.answered);
              const answerCount = push.answerCount ?? 0;
              const commentCount = push.commentCount ?? 0;
              return (
                <li
                  key={push.pushId}
                  className={`bd-push-library-card ${answered ? "bd-push-library-card-answered" : ""}`}
                  data-answered={answered ? "true" : "false"}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span>{familyPushStatusLabel(push.status)}</span>
                    <span
                      className={
                        answered
                          ? "rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800"
                          : "rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600"
                      }
                      data-testid={`student-push-answer-badge-${push.pushId}`}
                    >
                      {answered ? "已作答" : "未作答"}
                    </span>
                    <span data-testid={`student-push-counts-${push.pushId}`}>
                      {answerCount} 次作答 · {commentCount} 条评论
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{push.body || "(无正文)"}</p>
                  {push.linkUrl ? (
                    <p className="mt-1 break-all text-sm text-blue-700">{push.linkUrl}</p>
                  ) : null}
                  {studentId ? (
                    <Link
                      href={`/student/pushes/${push.pushId}`}
                      data-testid={`student-push-open-${push.pushId}`}
                      className="mt-auto inline-flex min-h-11 items-center font-bold text-[var(--bd-primary)]"
                    >
                      {answered ? "查看与继续讨论" : "查看并作答"}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
