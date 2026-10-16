"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PointsTodayCard } from "@/components/m2/points-today-card";
import { Alert, LoadingState } from "@/components/ui/page-shell";
import { apiFetch, type SessionInfo } from "@/lib/client/api";
import { fetchGoals } from "@/lib/client/m2-api";
import { fetchRedemptions } from "@/lib/client/m6-api";
import {
  buildTrainingOptions,
  fetchOwnTrainingSummary,
  type SubjectTrainingSummary,
} from "@/lib/client/training-api";

type LinkedStudent = {
  studentId: string;
  displayName: string;
};

function FamilyPendingActions({ students }: { students: LinkedStudent[] }) {
  const [actions, setActions] = useState<Array<{ id: string; label: string; href: string }> | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    void Promise.all([
      fetchGoals(),
      Promise.all(
        students.map(async (student) => ({
          student,
          result: await fetchRedemptions(student.studentId),
        })),
      ),
    ])
      .then(([goals, redemptions]) => {
        if (!alive) return;
        setActions([
          ...goals.goals
            .filter((goal) => goal.canApprove || goal.canEvaluate)
            .map((goal) => ({
              id: goal.assignmentId,
              label: `${goal.subjectName} · ${goal.canApprove ? "待审批目标" : "待评定目标"}：${goal.content}`,
              href: `/parent/goals?studentId=${encodeURIComponent(goal.subjectId)}`,
            })),
          ...redemptions.flatMap(({ student, result }) =>
            result.redemptions
              .filter((item) => item.status === "pending")
              .map((item) => ({
                id: item.id,
                label: `${student.displayName} · 待审批兑换 ${item.costSnapshot} 分`,
                href: `/parent/students/${student.studentId}/redemption`,
              })),
          ),
        ]);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [students, reload]);

  return (
    <section className="bd-panel" data-testid="family-pending-actions">
      <div className="bd-section-heading">
        <h2>需要你处理</h2>
        <Link href="/parent/goals">查看目标 →</Link>
      </div>
      {error ? (
        <Alert tone="error">
          待办暂时无法加载。
          <button
            type="button"
            className="bd-inline-link"
            onClick={() => setReload((value) => value + 1)}
          >
            重试
          </button>
        </Alert>
      ) : actions === null ? (
        <LoadingState label="加载家庭待办…" />
      ) : actions.length ? (
        <ul className="bd-pending-list">
          {actions.map((action) => (
            <li key={action.id}>
              <Link className="bd-training-row" href={action.href}>
                {action.label}
                <span aria-hidden="true"> →</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bd-caption">目前没有待审批的目标或兑换，可以看看孩子今天的进展。</p>
      )}
    </section>
  );
}

function TrainingOverview() {
  const [summaries, setSummaries] = useState<SubjectTrainingSummary[] | null>(null);
  const [error, setError] = useState(false);
  const options = buildTrainingOptions("/parent/training");
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
        <h2>家长训练近况</h2>
        <Link href="/parent/training">查看全部 →</Link>
      </div>
      <p className="bd-caption mb-4">大朋友也能练习反应、专注和记忆。</p>
      {error ? (
        <Alert tone="error">训练近况暂时加载失败。</Alert>
      ) : !summaries ? (
        <LoadingState />
      ) : (
        <div className="bd-training-list">
          {options.map((option, index) => {
            const last = summaries[index]?.lastSession;
            return (
              <Link key={option.key} href={option.href} className="bd-training-row">
                <span className={`bd-training-icon bd-tone-${index}`} aria-hidden="true">
                  {["⚡", "🎨", "🔢"][index]}
                </span>
                <div>
                  <strong>{option.title}</strong>
                  <p>
                    {last?.finishedAt
                      ? `最近结束 · ${new Date(last.finishedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                      : "还没有完成记录"}
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

export function ParentHomeDashboard({ session }: { session: SessionInfo }) {
  const [students, setStudents] = useState<LinkedStudent[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    void apiFetch<{ students: LinkedStudent[] }>("/api/family/students")
      .then((result) => {
        if (alive) setStudents(result.students);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const name = session.displayName || session.account || "家长";

  return (
    <div className="bd-home-dashboard bd-parent-home" data-testid="parent-home-dashboard">
      <header className="bd-home-greeting">
        <div>
          <p className="bd-home-eyebrow">家庭空间 · 一起成长</p>
          <h1 className="bd-home-title">{name}，欢迎回来</h1>
          <p className="bd-home-note">先处理家庭待办，再看孩子今天的进展。</p>
        </div>
      </header>

      <div className="bd-home-columns">
        <div className="bd-home-primary flex flex-col gap-4">
          {students?.length ? <FamilyPendingActions students={students} /> : null}
          <section className="bd-panel">
            <div className="bd-section-heading">
              <h2>学生今日概览</h2>
              <Link href="/parent/students">管理学生 →</Link>
            </div>
            {error ? (
              <Alert tone="error">
                家庭动态加载失败。{" "}
                <button
                  type="button"
                  className="bd-inline-link"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  重试
                </button>
              </Alert>
            ) : students === null ? (
              <LoadingState label="加载学生…" />
            ) : students.length ? (
              <div className="flex flex-col gap-3">
                {students.map((student) => (
                  <PointsTodayCard
                    key={student.studentId}
                    studentId={student.studentId}
                    studentName={student.displayName}
                    planHref={`/parent/students/${student.studentId}/schedule`}
                  />
                ))}
              </div>
            ) : (
              <div className="bd-empty">
                <span aria-hidden="true">🏡</span>
                <h3>把成长的小伙伴接进来</h3>
                <p>还没有关联的学生。创建账号后会直接加入你的家庭。</p>
                <Link className="bd-inline-link" href="/parent/students/new">
                  创建学生账号 →
                </Link>
              </div>
            )}
          </section>
        </div>
        <aside className="bd-home-secondary">
          <Link
            href="/parent/plans?scope=self"
            className="bd-parent-schedule-card"
            data-testid="parent-schedule-card"
          >
            <span className="bd-action-icon" aria-hidden="true">
              🗓️
            </span>
            <span>
              <strong>计划日程</strong>
              <small>安排并查看自己的计划与日程</small>
            </span>
            <span aria-hidden="true">↗</span>
          </Link>
          <TrainingOverview />
        </aside>
      </div>
    </div>
  );
}
