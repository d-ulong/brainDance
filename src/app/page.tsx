"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PointsTodayCard } from "@/components/m2/points-today-card";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { apiFetch, fetchSession, type SessionInfo } from "@/lib/client/api";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-medium hover:bg-neutral-50"
    >
      {children}
    </Link>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);

  useEffect(() => {
    void fetchSession().then(setSession);
  }, []);

  if (session === undefined) {
    return (
      <PageShell title="BrainDance" subtitle="M1 家庭学习与反应力训练">
        <LoadingState />
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell title="BrainDance" subtitle="M1 家庭学习与反应力训练">
        <nav className="flex flex-col gap-3">
          <NavLink href="/login">登录</NavLink>
          <NavLink href="/register">家长注册</NavLink>
        </nav>
      </PageShell>
    );
  }

  if (!session.contactVerified && session.role !== "admin") {
    return (
      <PageShell title="BrainDance">
        <Alert tone="info">请先完成联系方式验证。</Alert>
        <NavLink href="/verify-contact">去验证</NavLink>
      </PageShell>
    );
  }

  if (session.role === "admin") {
    return (
      <PageShell title="BrainDance" subtitle="管理员" showLogout>
        <nav className="flex flex-col gap-3">
          <NavLink href="/admin/invitations">创建邀请码</NavLink>
        </nav>
      </PageShell>
    );
  }

  if (session.role === "parent") {
    return <ParentHome />;
  }

  if (session.mustChangePassword) {
    router.replace("/student/change-password");
    return (
      <PageShell title="BrainDance">
        <LoadingState label="需要修改初始密码…" />
      </PageShell>
    );
  }

  return (
    <PageShell title="BrainDance" subtitle="学生中心" showLogout>
      <PointsTodayCard studentId={session.userId} />
      <nav className="flex flex-col gap-3">
        <NavLink href="/student/schedule">今日日程</NavLink>
        <NavLink href="/student/pushes">家庭推送</NavLink>
        <NavLink href="/student/redemption">积分兑换</NavLink>
        <NavLink href="/student/export">数据导出</NavLink>
        <NavLink href="/student/link">关联家长</NavLink>
        <NavLink href="/student/training">训练中心</NavLink>
        <NavLink href="/student/account-deletion">账户删除</NavLink>
      </nav>
    </PageShell>
  );
}

type LinkedStudent = {
  studentId: string;
  displayName: string;
};

function ParentHome() {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<LinkedStudent[]>([]);

  useEffect(() => {
    void apiFetch<{ students: LinkedStudent[] }>("/api/family/students")
      .then((result) => setStudents(result.students))
      .catch(() => setStudents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell title="BrainDance" subtitle="家长中心" showLogout>
      {loading ? (
        <LoadingState label="加载学生与积分…" />
      ) : students.length === 0 ? (
        <Alert tone="info">关联学生后，可在此查看积分与今日任务。</Alert>
      ) : (
        <div className="flex flex-col gap-3">
          {students.map((student) => (
            <PointsTodayCard
              key={student.studentId}
              studentId={student.studentId}
              studentName={student.displayName}
              planHref={`/parent/students/${student.studentId}/plan`}
            />
          ))}
        </div>
      )}
      <nav className="flex flex-col gap-3">
        <NavLink href="/parent/students/new">创建学生账号</NavLink>
        <NavLink href="/parent/link">关联学生</NavLink>
        <NavLink href="/parent/students">查看已关联学生</NavLink>
      </nav>
    </PageShell>
  );
}
