"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PointsTodayCard } from "@/components/m2/points-today-card";
import { Alert, LoadingState } from "@/components/ui/page-shell";
import { apiFetch, type SessionInfo } from "@/lib/client/api";
import {
  buildTrainingOptions,
  fetchOwnTrainingSummary,
  type SubjectTrainingSummary,
} from "@/lib/client/training-api";

type LinkedStudent = {
  studentId: string;
  displayName: string;
};

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

  useEffect(() => {
    void apiFetch<{ students: LinkedStudent[] }>("/api/family/students")
      .then((result) => setStudents(result.students))
      .catch(() => setError(true));
  }, []);

  const name = session.displayName || session.account || "家长";

  return (
    <div className="bd-home-dashboard bd-parent-home" data-testid="parent-home-dashboard">
      <header className="bd-home-greeting">
        <div>
          <p className="bd-home-eyebrow">家庭空间 · 一起成长</p>
          <h1 className="bd-home-title">{name}，欢迎回来</h1>
          <p className="bd-home-note">先看孩子今天的进展，再安排自己的练习。</p>
        </div>
      </header>

      <div className="bd-home-columns">
        <div className="bd-home-primary flex flex-col gap-4">
          <section className="bd-panel">
            <div className="bd-section-heading">
              <h2>学生今日概览</h2>
              <Link href="/parent/students">管理学生 →</Link>
            </div>
            {error ? (
              <Alert tone="error">
                家庭动态加载失败。{" "}
                <Link className="underline" href="/parent/students">
                  进入学生页重试
                </Link>
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

          <section className="bd-panel">
            <div className="bd-section-heading">
              <h2>陪伴入口</h2>
            </div>
            <div className="bd-action-grid">
              <Link href="/parent/students" className="bd-action-card">
                <span className="bd-action-icon" aria-hidden="true">
                  🌱
                </span>
                <strong>
                  学生管理
                  <span aria-hidden="true">↗</span>
                </strong>
                <span>计划、训练、推送与兑换</span>
              </Link>
              <Link href="/parent/plans?scope=self" className="bd-action-card">
                <span className="bd-action-icon" aria-hidden="true">
                  🗓️
                </span>
                <strong>
                  我的计划
                  <span aria-hidden="true">↗</span>
                </strong>
                <span>家长本人的计划与日程</span>
              </Link>
            </div>
          </section>
        </div>
        <aside className="bd-home-secondary">
          <TrainingOverview />
        </aside>
      </div>
    </div>
  );
}
