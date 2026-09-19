"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ParentHomeDashboard } from "@/components/home/parent-home-dashboard";
import { StudentHomeDashboard } from "@/components/home/student-home-dashboard";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { fetchSession, type SessionInfo } from "@/lib/client/api";

function PublicWelcome() {
  return (
    <section className="bd-welcome">
      <div className="relative z-10 min-w-0">
        <span className="bd-welcome-label">每天一点点，进步看得见</span>
        <h2>让脑力，跳支快乐的舞。</h2>
        <p>从一个小目标开始，找到今天的好状态。</p>
        <div className="bd-welcome-tags">
          <span>✦ 学习计划</span>
          <span>✦ 脑力训练</span>
          <span>✦ 家庭陪伴</span>
        </div>
      </div>
      <div className="bd-mascot" aria-hidden="true">
        <span>✦</span>
        <div>●‿●</div>
        <i>✦</i>
      </div>
    </section>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  useEffect(() => {
    void fetchSession().then((value) => {
      if (value?.mustChangePassword) router.replace("/student/change-password");
      setSession(value);
    });
  }, [router]);
  if (session === undefined || session?.mustChangePassword)
    return (
      <PageShell title="今天" hideHeading>
        <LoadingState />
      </PageShell>
    );
  if (!session)
    return (
      <PageShell title="欢迎来到脑力乐园" hideTabs hideHeading>
        <PublicWelcome />
        <section className="bd-panel">
          <div className="bd-section-heading">
            <h2>准备好，开始今天的成长</h2>
          </div>
          <div className="bd-action-grid">
            <Link href="/login" className="bd-action-card">
              <span className="bd-action-icon" aria-hidden="true">
                🚀
              </span>
              <strong>
                登录
                <span aria-hidden="true">↗</span>
              </strong>
              <span>回到你的学习与训练空间</span>
            </Link>
            <Link href="/register" className="bd-action-card">
              <span className="bd-action-icon" aria-hidden="true">
                🌱
              </span>
              <strong>
                注册账号
                <span aria-hidden="true">↗</span>
              </strong>
              <span>家长和 13–18 岁学生均可受邀加入</span>
            </Link>
          </div>
        </section>
      </PageShell>
    );
  if (!session.contactVerified && session.role !== "admin")
    return (
      <PageShell title="完成注册">
        <Alert>请先完成联系方式验证。</Alert>
        <Link className="bd-inline-link" href="/verify-contact">
          去验证 →
        </Link>
      </PageShell>
    );
  if (session.role === "parent")
    return (
      <PageShell title="今天" showLogout hideHeading workspace="parent">
        <ParentHomeDashboard session={session} />
      </PageShell>
    );
  if (session.role === "admin")
    return (
      <PageShell title="管理概览" showLogout>
        <section className="bd-panel">
          <h2 className="text-lg font-bold">邀请制家庭空间</h2>
          <p className="bd-caption my-3">
            家长使用家长邀请码；13–18 岁学生使用学生邀请码。5–12
            岁学生由家长在家庭中创建，创建后直接关联。
          </p>
          <Link className="bd-inline-link" href="/admin/invitations">
            创建邀请码 →
          </Link>
        </section>
      </PageShell>
    );
  return (
    <PageShell title="今天" showLogout hideHeading>
      <StudentHomeDashboard session={session} />
    </PageShell>
  );
}
