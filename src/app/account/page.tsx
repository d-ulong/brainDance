"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ui/app-theme";
import { LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession, type SessionInfo } from "@/lib/client/api";

export default function AccountPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => {
    void fetchSession().then((value) => {
      if (!value) router.replace("/login");
      else if (value.mustChangePassword) router.replace("/student/change-password");
      else setSession(value);
    });
  }, [router]);
  const roleLabel =
    session?.role === "parent" ? "家长" : session?.role === "admin" ? "管理员" : "学生";
  const links =
    session?.role === "student"
      ? [
          ["/student/plans", "🗓️", "计划日程"],
          ["/student/redemption", "⭐", "积分与兑换"],
          ["/student/change-password", "🔑", "修改密码"],
          ["/student/link", "🤝", "家庭关联"],
          ["/student/reflection", "✏️", "每日总结"],
          ["/student/export", "📦", "数据导出"],
          ["/student/account-deletion", "⚙️", "账户删除"],
        ]
      : session?.role === "parent"
        ? [
            ["/parent/goals?scope=self", "🎯", "我的目标"],
            ["/parent/plans?scope=self", "🗓️", "我的计划"],
            ["/parent/schedule", "📅", "我的日程"],
            ["/parent/change-password", "🔑", "修改密码"],
            ["/parent/training", "🧩", "我的训练"],
            ["/parent/students", "🏡", "我的家庭"],
            ["/parent/link", "🤝", "关联已有学生"],
          ]
        : [["/admin/invitations", "✉️", "邀请新成员"]];
  return (
    <PageShell title="我的" showLogout>
      {!session ? (
        <LoadingState />
      ) : (
        <div className="bd-account-layout">
          <section className="bd-panel bd-account-profile flex gap-5">
            <div className="bd-avatar" aria-hidden="true">
              {session.displayName?.slice(0, 1) || "☺"}
            </div>
            <div className="min-w-0">
              <span className="bd-eyebrow">{roleLabel}账号</span>
              <h2 className="mt-1 text-2xl font-black break-words" data-testid="account-name">
                {session.displayName || session.account}
              </h2>
              <p className="mt-2 text-sm break-all" data-testid="account-identifier">
                账号：{session.account || "未设置登录账号"}
              </p>
            </div>
          </section>
          <section className="bd-panel">
            <h2 className="mb-3 text-lg font-bold">外观主题</h2>
            <p className="mb-3 text-sm text-[var(--bd-muted)]">
              深空探索站与奶油糖果工坊可随时切换，偏好会保存在本浏览器。
            </p>
            <ThemeToggle />
          </section>
          <section className="bd-panel">
            <h2 className="mb-3 text-lg font-bold">账号与家庭</h2>
            <div className="divide-y divide-[var(--bd-border)]">
              {links.map(([href, icon, title]) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-14 items-center gap-3 py-3 font-medium"
                >
                  <span aria-hidden="true">{icon}</span>
                  {title}
                  <span className="ml-auto" aria-hidden="true">
                    →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </PageShell>
  );
}
