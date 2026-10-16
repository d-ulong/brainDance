"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { StudentScheduleWorkspace } from "@/components/schedule/student-schedule-workspace";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { SessionLoadError, LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession } from "@/lib/client/api";

export default function ParentPersonalSchedulePage() {
  const [sessionFailed, setSessionFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const router = useRouter();
  const [parentId, setParentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSessionFailed(false);
    setLoading(true);
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") return router.replace("/login");
      setParentId(session.userId);
      setLoading(false);
    })().catch(() => {
      setSessionFailed(true);
      setLoading(false);
    });
  }, [router, sessionAttempt]);

  if (sessionFailed)
    return (
      <PageShell title="加载失败" hideTabs>
        <SessionLoadError
          onRetry={() => {
            setSessionFailed(false);
            setLoading(true);
            setSessionAttempt((attempt) => attempt + 1);
          }}
        />
      </PageShell>
    );
  if (loading) {
    return (
      <PageShell title="我的日程">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="我的日程" backHref="/account" showLogout>
      <ErrorDialog message={error} onClose={() => setError(null)} />
      {parentId ? (
        <StudentScheduleWorkspace studentId={parentId} actorMode="parent" selfSubject />
      ) : null}
    </PageShell>
  );
}
