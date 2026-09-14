"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState } from "@/components/ui/page-shell";
import {
  fetchPointsBalance,
  fetchPointsPeriodSummary,
  fetchScheduleItems,
  scheduleStatusLabel,
  todayFamilyDate,
  type PointsPeriodSummaryDto,
  type ScheduleItemDto,
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
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [items, setItems] = useState<ScheduleItemDto[]>([]);
  const [points, setPoints] = useState<PointsPeriodSummaryDto | null>(null);
  const [openDetail, setOpenDetail] = useState<"balance" | "total" | "completed" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const today = todayFamilyDate();
    try {
      const [balanceResult, scheduleResult, pointsResult] = await Promise.all([
        fetchPointsBalance(studentId),
        fetchScheduleItems(studentId, today, today),
        fetchPointsPeriodSummary(studentId, today, today),
      ]);
      setBalance(balanceResult.balance);
      const todayItems = scheduleResult.items.filter((item) => item.familyDate === today);
      setItems(todayItems);
      setPoints(pointsResult);
      setTotal(todayItems.length);
      setCompleted(todayItems.filter((item) => item.effectiveStatus === "completed").length);
      if (todayItems.length === 0) {
        setTodayTaskLabel("今日暂无日程");
      } else {
        const item =
          todayItems.find((item) => item.effectiveStatus === "in_progress") ??
          todayItems.find((item) => item.effectiveStatus === "pending") ??
          todayItems[0];
        const time = item.scheduledAt
          ? new Date(item.scheduledAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "Asia/Shanghai",
            })
          : "时间待定";
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
    <section className="bd-panel" data-testid={`points-today-card-${studentId}`}>
      <h2 className="mb-4 text-lg font-bold">{studentName || "我的今日概览"}</h2>
      {error ? (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      ) : (
        <>
          <dl className="bd-stat-grid">
            <button type="button" className="bd-stat bd-tone-0 relative text-left" aria-expanded={openDetail === "balance"} onClick={() => setOpenDetail((value) => value === "balance" ? null : "balance")}>
              <dt className="text-neutral-600">积分余额</dt>
              <dd className="font-semibold" data-testid="points-balance">
                {balance ?? 0}
              </dd>
              {openDetail === "balance" ? <span className="bd-stat-popover" role="status"><strong>今日净得分 {points?.netPoints ?? 0}</strong><span>日程 {points?.schedulePoints ?? 0} · 目标 {points?.goalRewards ?? 0} · 奖扣 {points?.manualAdjustments ?? 0}</span>{points?.entries.slice(0, 5).map((entry) => <span key={entry.id}>{entry.amount > 0 ? "+" : ""}{entry.amount} · {entry.reason}</span>)}</span> : null}
            </button>
            <button type="button" className="bd-stat bd-tone-1 relative text-left" aria-expanded={openDetail === "total"} onClick={() => setOpenDetail((value) => value === "total" ? null : "total")}>
              <dt>今日任务</dt>
              <dd>
                {total}
                <small> 项</small>
              </dd>
              {openDetail === "total" ? <span className="bd-stat-popover" role="status"><strong>今日全部完成最高可得 {points?.maximumSchedulePoints ?? 0} 分</strong>{items.length ? items.map((item) => <span key={item.id}>{item.title} · {scheduleStatusLabel(item.effectiveStatus)}</span>) : <span>今日暂无日程</span>}</span> : null}
            </button>
            <button type="button" className="bd-stat bd-tone-2 relative text-left" aria-expanded={openDetail === "completed"} onClick={() => setOpenDetail((value) => value === "completed" ? null : "completed")}>
              <dt>已完成</dt>
              <dd>
                {completed}
                <small> 项</small>
              </dd>
              {openDetail === "completed" ? <span className="bd-stat-popover" role="status"><strong>完成进度 {completed}/{total}</strong>{items.filter((item) => item.effectiveStatus === "completed").length ? items.filter((item) => item.effectiveStatus === "completed").map((item) => <span key={item.id}>{item.title}</span>) : <span>今天还没有完成任务</span>}</span> : null}
            </button>
          </dl>
          <p className="bd-caption mt-4" data-testid="today-task-status">
            {todayTaskLabel}
          </p>
        </>
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
