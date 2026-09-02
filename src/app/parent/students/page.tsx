"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { apiFetch, fetchSession } from "@/lib/client/api";

type LinkedStudent = {
  studentId: string;
  relationshipId: string;
  displayName: string;
  username: string | null;
};

export default function ParentStudentsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<LinkedStudent[]>([]);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/verify-contact");
        return;
      }

      try {
        const result = await apiFetch<{ students: LinkedStudent[] }>("/api/family/students");
        setStudents(result.students);
      } catch {
        setError("无法加载已关联学生");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) {
    return (
      <PageShell title="已关联学生">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="已关联学生" backHref="/" showLogout>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {students.length === 0 ? (
        <Alert tone="info">暂无已关联学生。请先创建学生账号并完成关联。</Alert>
      ) : (
        <ul className="flex flex-col gap-3">
          {students.map((student) => (
            <li
              key={student.studentId}
              className="rounded-xl border border-neutral-300 bg-white p-4"
            >
              <p className="font-medium">{student.displayName}</p>
              <p className="text-sm text-neutral-500">
                @{student.username ?? student.studentId.slice(0, 8)}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <Link
                  href={`/parent/students/${student.studentId}/plan`}
                  data-testid={`student-plan-${student.studentId}`}
                  className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  学习计划
                </Link>
                <Link
                  href={`/parent/students/${student.studentId}/training`}
                  data-testid={`linked-student-${student.studentId}`}
                  className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  训练汇总
                </Link>
                <Link
                  href={`/parent/students/${student.studentId}/redemption`}
                  data-testid={`student-redemption-${student.studentId}`}
                  className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  兑换目录
                </Link>
                <Link
                  href={`/parent/students/${student.studentId}/pushes`}
                  data-testid={`student-pushes-${student.studentId}`}
                  className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  家庭推送
                </Link>
                <Link
                  href={`/parent/students/${student.studentId}/export`}
                  data-testid={`student-export-${student.studentId}`}
                  className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  数据导出
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
