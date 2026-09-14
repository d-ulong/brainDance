"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { StudentManagementTabs } from "@/components/ui/student-management-tabs";
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
    <PageShell title="学生" backHref="/" showLogout hideHeading secondaryNavigation={<StudentManagementTabs />}>
      <div className="bd-library-toolbar">
        <div className="bd-library-toolbar-copy">
          <h2>家庭学生</h2>
          <p>在一个地方查看每个孩子的计划、训练与家庭内容。</p>
        </div>
        <div className="flex flex-wrap gap-3">
        <Link className="bd-inline-link" href="/parent/students/new">
          ＋ 创建学生账号
        </Link>
        <Link className="bd-inline-link" href="/parent/link">
          关联已有学生 →
        </Link>
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {students.length === 0 ? (
        <Alert tone="info">
          暂无已关联学生。新建学生账号会直接加入家庭；孩子已有账号时才需要发送关联申请。
        </Alert>
      ) : (
        <ul className="bd-student-grid">
          {students.map((student) => (
            <li
              key={student.studentId}
              className="bd-student-card"
            >
              <p className="font-medium">{student.displayName}</p>
              <p className="text-sm text-neutral-500">
                {student.username ? `@${student.username}` : student.displayName}
              </p>
              <nav aria-label={`${student.displayName}的功能`}>
                <Link
                  href={`/parent/students/${student.studentId}/plans`}
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
                  href={`/parent/students/${student.studentId}/schedule`}
                  data-testid={`student-schedule-${student.studentId}`}
                  className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  查看日程
                </Link>
                <Link
                  href="/parent/redemption"
                  data-testid={`student-redemption-${student.studentId}`}
                  className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  兑换项目
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
              </nav>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
