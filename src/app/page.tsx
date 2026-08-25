"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession, type SessionInfo } from "@/lib/client/api";

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
    return (
      <PageShell title="BrainDance" subtitle="家长中心" showLogout>
        <nav className="flex flex-col gap-3">
          <NavLink href="/parent/students/new">创建学生账号</NavLink>
          <NavLink href="/parent/link">关联学生</NavLink>
          <NavLink href="/parent/students">查看已关联学生</NavLink>
        </nav>
      </PageShell>
    );
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
      <nav className="flex flex-col gap-3">
        <NavLink href="/student/link">关联家长</NavLink>
        <NavLink href="/student/training/reaction">反应力训练</NavLink>
      </nav>
    </PageShell>
  );
}
