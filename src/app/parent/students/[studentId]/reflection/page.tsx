"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  fetchDailyReflection,
  reflectionVisibilityLabel,
  todayFamilyDate,
  type DailyReflectionDto,
} from "@/lib/client/m4-api";

export default function ParentReflectionPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [reflection, setReflection] = useState<DailyReflectionDto | null>(null);
  const [notFound, setNotFound] = useState(false);

  const loadReflection = useCallback(async (sid: string) => {
    setError(null);
    setForbidden(false);
    setNotFound(false);

    try {
      const data = await fetchDailyReflection(sid, todayFamilyDate());
      setReflection(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        return;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      const sid = resolved.studentId;

      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/parent/verify-contact");
        return;
      }

      setStudentId(sid);
      try {
        await loadReflection(sid);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载总结失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadReflection, params, router]);

  if (loading) {
    return (
      <PageShell title="今日总结">
        <LoadingState label="加载中…" />
      </PageShell>
    );
  }

  return (
    <PageShell title="今日总结">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8">
        {error ? <Alert tone="error">{error}</Alert> : null}

        {forbidden ? (
          <Alert tone="error" data-testid="reflection-forbidden">
            无权查看该总结
          </Alert>
        ) : null}

        {notFound ? (
          <p className="text-sm text-gray-600" data-testid="reflection-not-found">
            该学生今天尚未提交总结
          </p>
        ) : null}

        {reflection ? (
          <article className="flex flex-col gap-2 rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500" data-testid="reflection-visibility">
              {reflectionVisibilityLabel(reflection.visibility)}总结 · {reflection.familyDate}
            </p>
            <p className="whitespace-pre-wrap text-base" data-testid="reflection-body">
              {reflection.body}
            </p>
          </article>
        ) : null}

        {!reflection && !forbidden && !notFound && studentId ? (
          <p className="text-sm text-gray-600">暂无总结内容</p>
        ) : null}
      </div>
    </PageShell>
  );
}
