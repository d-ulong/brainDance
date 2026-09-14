"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { StudentScheduleWorkspace } from "@/components/schedule/student-schedule-workspace";
import { StudentContextBanner } from "@/components/ui/student-context-banner";
import { LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession } from "@/lib/client/api";

export default function ParentStudentSchedulePage({ params }: { params: Promise<{ studentId: string }> }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async () => {
      const [{ studentId: id }, session] = await Promise.all([params, fetchSession()]);
      if (!session || session.role !== "parent") return router.replace("/login");
      setStudentId(id);
      setLoading(false);
    })();
  }, [params, router]);
  if (loading) return <PageShell title="学生日程"><LoadingState /></PageShell>;
  return <PageShell title="学生日程" backHref="/parent/students" showLogout hideHeading>
    {studentId ? <StudentContextBanner studentId={studentId} label="正在查看日程的学生" /> : null}
    {studentId ? <StudentScheduleWorkspace studentId={studentId} actorMode="parent" /> : null}
  </PageShell>;
}
