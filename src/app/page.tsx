"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PointsTodayCard } from "@/components/m2/points-today-card";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { apiFetch, fetchSession, type SessionInfo } from "@/lib/client/api";
import {
  buildTrainingOptions,
  fetchOwnTrainingSummary,
  type SubjectTrainingSummary,
} from "@/lib/client/training-api";

function ActionCard({
  href,
  icon,
  title,
  description,
  testId,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  testId?: string;
}) {
  return (
    <Link href={href} className="bd-action-card" data-testid={testId}>
      <span className="bd-action-icon" aria-hidden="true">
        {icon}
      </span>
      <strong>
        {title}
        <span aria-hidden="true">↗</span>
      </strong>
      <span>{description}</span>
    </Link>
  );
}

function Welcome({ session }: { session?: SessionInfo }) {
  const name = session?.displayName || session?.account || "新朋友";
  return (
    <section className="bd-welcome">
      <div className="relative z-10 min-w-0">
        <span className="bd-welcome-label">
          {session?.role === "parent"
            ? "一起成长 · 家庭空间"
            : session?.role === "admin"
              ? "用心守护 · 管理空间"
              : "每天一点点，进步看得见"}
        </span>
        <h2>{session ? name + "，你好呀！" : "让脑力，跳支快乐的舞。"}</h2>
        <p>
          {session?.role === "parent"
            ? "陪孩子向前一步，也留一点时间给自己。"
            : session?.role === "admin"
              ? "邀请家长与学生，开启家庭学习之旅。"
              : "从一个小目标开始，找到今天的好状态。"}
        </p>
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

function TrainingOverview({ role }: { role: "parent" | "student" }) {
  const [summaries, setSummaries] = useState<SubjectTrainingSummary[] | null>(null);
  const [error, setError] = useState(false);
  const options = buildTrainingOptions("/" + role + "/training");
  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetchOwnTrainingSummary("reaction"),
      fetchOwnTrainingSummary("stroop"),
      fetchOwnTrainingSummary("digit-span"),
    ])
      .then((rows) => {
        if (alive) setSummaries(rows);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="bd-panel">
      <div className="bd-section-heading">
        <h2>我的训练近况</h2>
        <Link href={"/" + role + "/training"}>查看全部 →</Link>
      </div>
      <p className="bd-caption mb-4">不和别人比，记录自己的每一步。</p>
      {error ? (
        <Alert tone="error">训练近况暂时加载失败，请到训练中心重试。</Alert>
      ) : !summaries ? (
        <LoadingState />
      ) : (
        <div className="bd-training-list">
          {options.map((option, index) => {
            const last = summaries[index]?.lastSession;
            return (
              <Link key={option.key} href={option.href} className="bd-training-row">
                <span className={"bd-training-icon bd-tone-" + index} aria-hidden="true">
                  {["⚡", "🎨", "🔢"][index]}
                </span>
                <div>
                  <strong>{option.title}</strong>
                  <p>
                    {last?.finishedAt
                      ? "最近结束 · " +
                        new Date(last.finishedAt).toLocaleDateString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })
                      : last?.status === "active"
                        ? "有训练正在进行"
                        : "还没有完成记录，来试试吧"}
                  </p>
                </div>
                <span className="ml-auto" aria-hidden="true">
                  →
                </span>
              </Link>
            );
          })}
        </div>
      )}
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
      <PageShell title="今天">
        <LoadingState />
      </PageShell>
    );
  if (!session)
    return (
      <PageShell title="欢迎来到脑力乐园">
        <Welcome />
        <section className="bd-panel">
          <div className="bd-section-heading">
            <h2>准备好，开始今天的成长</h2>
          </div>
          <div className="bd-action-grid">
            <ActionCard href="/login" icon="🚀" title="登录" description="回到你的学习与训练空间" />
            <ActionCard
              href="/register"
              icon="🌱"
              title="注册账号"
              description="家长和 13–18 岁学生均可受邀加入"
            />
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
  if (session.role === "parent") return <ParentHome session={session} />;
  if (session.role === "admin")
    return (
      <PageShell title="管理概览" showLogout>
        <Welcome session={session} />
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
    <PageShell title="今天，向前一小步" showLogout>
      <Welcome session={session} />
      <div className="bd-dashboard-grid">
        <div className="flex min-w-0 flex-col gap-4">
          <PointsTodayCard studentId={session.userId} />
          <section className="bd-panel">
            <div className="bd-section-heading">
              <h2>现在适合做什么</h2>
            </div>
            <div className="bd-action-grid">
              <ActionCard
                href="/student/plans?view=schedule"
                icon="📚"
                title="今日日程"
                description="看看今天的安排，完成一个小目标"
              />
              <ActionCard
                href="/student/plans"
                icon="🗓️"
                title="我的计划"
                description="查看家长安排，也可以制定自己的计划"
              />
              <ActionCard
                href="/student/training"
                icon="🧩"
                title="训练中心"
                description="反应、专注、记忆，选一项开始"
              />
            </div>
          </section>
        </div>
        <TrainingOverview role="student" />
      </div>
    </PageShell>
  );
}

function ParentHome({ session }: { session: SessionInfo }) {
  const [students, setStudents] = useState<Array<{
    studentId: string;
    displayName: string;
  }> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    void apiFetch<{ students: Array<{ studentId: string; displayName: string }> }>(
      "/api/family/students",
    )
      .then((result) => setStudents(result.students))
      .catch(() => setError(true));
  }, []);
  return (
    <PageShell title="今天，和家人一起成长" showLogout>
      <Welcome session={session} />
      <div className="bd-dashboard-grid">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="bd-panel">
            <div className="bd-section-heading">
              <h2>家庭今日动态</h2>
              <Link href="/parent/students">我的家庭 →</Link>
            </div>
            {error ? (
              <Alert tone="error">家庭动态加载失败，请进入“学生”页面重试。</Alert>
            ) : students === null ? (
              <LoadingState />
            ) : students.length ? (
              <div className="flex flex-col gap-3">
                {students.map((student) => (
                  <PointsTodayCard
                    key={student.studentId}
                    studentId={student.studentId}
                    studentName={student.displayName}
                    planHref={"/parent/students/" + student.studentId + "/plan"}
                  />
                ))}
              </div>
            ) : (
              <div className="bd-empty">
                <span aria-hidden="true">🏡</span>
                <h3>把成长的小伙伴接进来</h3>
                <p>还没有关联的学生。创建孩子的账号后，会直接加入你的家庭。</p>
                <Link className="bd-inline-link" href="/parent/students/new">
                  创建学生账号 →
                </Link>
                <Link className="bd-caption mt-3 block underline" href="/parent/link">
                  孩子已有账号？关联已有学生
                </Link>
              </div>
            )}
          </section>
          <section className="bd-panel">
            <div className="bd-section-heading">
              <h2>留一点时间，给陪伴和自己</h2>
            </div>
            <div className="bd-action-grid">
              <ActionCard
                href="/parent/students"
                icon="🌱"
                title="陪伴孩子"
                description="查看计划、训练与家庭内容"
              />
              <ActionCard
                href="/parent/training"
                icon="🧩"
                title="家长训练中心"
                description="大朋友也能练习反应、专注和记忆"
                testId="parent-training-nav"
              />
            </div>
          </section>
        </div>
        <TrainingOverview role="parent" />
      </div>
    </PageShell>
  );
}
