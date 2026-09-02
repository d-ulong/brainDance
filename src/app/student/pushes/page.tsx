"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
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
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8">
        {error ? (
          <Alert tone="error" data-testid="student-push-error">
            {error}
          </Alert>
        ) : null}
        {pushes.length === 0 ? (
          <p className="text-sm text-neutral-600" data-testid="student-push-empty">
            暂无已发布推送
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="student-push-list">
            {pushes.map((push) => (
              <li key={push.pushId} className="rounded border border-neutral-300 p-3">
                <p className="text-xs text-neutral-500">{familyPushStatusLabel(push.status)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{push.body || "(无正文)"}</p>
                {push.linkUrl ? (
                  <p className="mt-1 break-all text-sm text-blue-700">{push.linkUrl}</p>
                ) : null}
                {studentId ? (
                  <Link
                    href={`/student/pushes/${push.pushId}`}
                    data-testid={`student-push-open-${push.pushId}`}
                    className="mt-2 inline-flex min-h-11 items-center text-sm underline"
                  >
                    查看并作答
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
