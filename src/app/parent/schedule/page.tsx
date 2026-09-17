"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { StudentScheduleWorkspace } from "@/components/schedule/student-schedule-workspace";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession } from "@/lib/client/api";

export default function ParentPersonalSchedulePage() {
  const router = useRouter();
  const [parentId, setParentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") return router.replace("/login");
      setParentId(session.userId);
      setLoading(false);
    })();
  }, [router]);

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
