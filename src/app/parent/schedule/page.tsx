"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ScheduleCalendar, rangeForCalendarDate, type CalendarView } from "@/components/schedule/schedule-calendar";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import { fetchPointsPeriodSummary, fetchScheduleItems, todayFamilyDate, type PointsPeriodSummaryDto, type ScheduleItemDto } from "@/lib/client/m2-api";

export default function ParentPersonalSchedulePage() {
  const router = useRouter();
  const [parentId, setParentId] = useState<string | null>(null);
  const [items, setItems] = useState<ScheduleItemDto[]>([]);
  const [summary, setSummary] = useState<PointsPeriodSummaryDto | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayFamilyDate());
  const [view, setView] = useState<CalendarView>("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (id: string, date: string, nextView: CalendarView) => {
    const range = rangeForCalendarDate(date, nextView);
    const [schedule, points] = await Promise.all([fetchScheduleItems(id, range.from, range.through), fetchPointsPeriodSummary(id, range.from, range.through)]);
    setItems(schedule.items); setSummary(points);
  }, []);
  useEffect(() => { void (async () => { const session = await fetchSession(); if (!session || session.role !== "parent") return router.replace("/login"); setParentId(session.userId); setLoading(false); })(); }, [router]);
  useEffect(() => { if (parentId) void load(parentId, selectedDate, view).catch((cause) => setError(cause instanceof ApiError ? cause.message : "无法加载我的日程")); }, [load, parentId, selectedDate, view]);
  if (loading) return <PageShell title="我的日程"><LoadingState /></PageShell>;
  return <PageShell title="我的日程" backHref="/account" showLogout>
    <ErrorDialog message={error} onClose={() => setError(null)} />
    <div className="mb-3 grid gap-3 rounded-3xl border border-[var(--bd-border)] bg-white p-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">个人计划</p><strong>只记录执行，不产生学生积分</strong></div><div><p className="text-sm text-slate-500">本期个人积分</p><strong>{summary?.netPoints ?? 0}</strong></div></div>
    <ScheduleCalendar items={items} selectedDate={selectedDate} view={view} onDateChange={setSelectedDate} onViewChange={setView} />
  </PageShell>;
}
