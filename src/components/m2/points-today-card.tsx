"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState } from "@/components/ui/page-shell";
import {
  fetchPointsBalance,
  fetchScheduleItems,
  scheduleStatusLabel,
  todayFamilyDate,
} from "@/lib/client/m2-api";

type PointsTodayCardProps = {
  studentId: string;
  studentName?: string;
  planHref?: string;
};

export function PointsTodayCard({ studentId, studentName, planHref }: PointsTodayCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [todayTaskLabel, setTodayTaskLabel] = useState<string>("—");

  const load = useCallback(async () => {
    setError(null);
    const today = todayFamilyDate();
    try {
      const [balanceResult, scheduleResult] = await Promise.all([
        fetchPointsBalance(studentId),
        fetchScheduleItems(studentId, today, today),
      ]);
      setBalance(balanceResult.balance);
      const todayItems = scheduleResult.items.filter((item) => item.familyDate === today);
      if (todayItems.length === 0) {
        setTodayTaskLabel("今日暂无日程");
      } else {
        const item = todayItems[0];
        const time = item.scheduledAt
          ? new Date(item.scheduledAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "Asia/Shanghai",
            })
          : "20:00";
        setTodayTaskLabel(`${time} · ${scheduleStatusLabel(item.effectiveStatus)}`);
      }
    } catch {
      setError("无法加载积分或今日任务");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section
        className="rounded-xl border border-neutral-300 bg-white p-4"
        data-testid={`points-today-card-${studentId}`}
      >
        <LoadingState label="加载积分与今日任务…" />
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border border-neutral-300 bg-white p-4"
      data-testid={`points-today-card-${studentId}`}
    >
      {studentName ? <p className="text-sm font-medium text-neutral-800">{studentName}</p> : null}
      {error ? (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      ) : (
        <dl className="mt-1 flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-neutral-600">积分余额</dt>
            <dd className="font-semibold" data-testid="points-balance">
              {balance ?? 0}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-neutral-600">今日任务</dt>
            <dd className="text-right break-words" data-testid="today-task-status">
              {todayTaskLabel}
            </dd>
          </div>
        </dl>
      )}
      {planHref ? (
        <Link
          href={planHref}
          className="mt-3 inline-block text-sm text-neutral-600 underline hover:text-neutral-900"
        >
          查看学习计划
        </Link>
      ) : null}
    </section>
  );
}
