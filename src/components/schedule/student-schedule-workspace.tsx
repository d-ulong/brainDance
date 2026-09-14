"use client";

import { useCallback, useEffect, useState } from "react";

import { ScheduleCalendar, rangeForCalendarDate, type CalendarView } from "@/components/schedule/schedule-calendar";
import { ClearScheduleDialog } from "@/components/schedule/clear-schedule-dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Modal } from "@/components/ui/modal";
import { PrimaryButton, SecondaryButton, Toast } from "@/components/ui/page-shell";
import { ApiError } from "@/lib/client/api";
import { clearSchedule, completeScheduleItem, fetchPointsPeriodSummary, fetchScheduleItems, startPlanItem, todayFamilyDate, type PointsPeriodSummaryDto, type ScheduleItemDto } from "@/lib/client/m2-api";

export function StudentScheduleWorkspace({ studentId, actorMode = "student" }: { studentId: string; actorMode?: "student" | "parent" }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [items, setItems] = useState<ScheduleItemDto[]>([]);
  const [summary, setSummary] = useState<PointsPeriodSummaryDto | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayFamilyDate());
  const [view, setView] = useState<CalendarView>("day");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completing, setCompleting] = useState<ScheduleItemDto | null>(null);
  const [completionMode, setCompletionMode] = useState<"end" | "duration">("duration");
  const [startedAt, setStartedAt] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [completionMaximum, setCompletionMaximum] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [showClear, setShowClear] = useState(false);

  const load = useCallback(async (date: string, calendarView: CalendarView) => {
    const range = rangeForCalendarDate(date, calendarView);
    const [schedule, points] = await Promise.all([
      fetchScheduleItems(studentId, range.from, range.through),
      fetchPointsPeriodSummary(studentId, range.from, range.through),
    ]);
    setItems(schedule.items);
    setSummary(points);
  }, [studentId]);

  useEffect(() => { void load(selectedDate, view).catch((cause) => setError(cause instanceof ApiError ? cause.message : "加载日程失败")); }, [load, selectedDate, view]);

  async function run(item: ScheduleItemDto, action: "start" | "complete", execution?: { startedAt?: string; completedAt?: string; durationMinutes?: number }) {
    setBusyId(item.id); setError(null);
    try {
      if (action === "start") await startPlanItem(item.id);
      else { await completeScheduleItem(item.id, execution); setCompleting(null); }
      setMessage(action === "start" ? actorMode === "parent" ? "已由家长代为开始计时" : "已开始计时" : actorMode === "parent" ? "已由家长代为完成，积分已记录" : "任务已完成并结算积分"); await load(selectedDate, view);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "操作失败"); }
    finally { setBusyId(null); }
  }

  function openCompletion(item: ScheduleItemDto) {
    const start = item.startedAt ? new Date(item.startedAt) : new Date(Date.now() - 30 * 60_000);
    const end = new Date();
    const localValue = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const maximum = localValue(end);
    setStartedAt(localValue(start));
    setCompletedAt(maximum);
    setCompletionMaximum(maximum);
    setDurationMinutes(String(Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60_000))));
    setCompletionMode("duration");
    setCompleting(item);
  }

  async function confirmClear(from: string, through: string) {
    setBusyId("clear"); setError(null);
    try {
      const result = await clearSchedule(studentId, from, through);
      setMessage(`已清除 ${result.clearedCount} 项未开始日程`);
      setShowClear(false);
      await load(selectedDate, view);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "清除日程失败"); }
    finally { setBusyId(null); }
  }

  return <section className="space-y-3" data-testid="student-schedule-workspace">
    <ErrorDialog message={error} onClose={() => setError(null)} />
    <Toast message={message} onClose={() => setMessage(null)} />
    <div className="flex flex-wrap items-stretch justify-between gap-3 rounded-3xl border border-[var(--bd-border)] bg-white p-4">
      <div><p className="text-sm text-slate-500">{view === "day" ? "今日" : view === "week" ? "本周" : "本月"}积分净变动</p><strong className={`text-2xl ${summary && summary.netPoints < 0 ? "text-rose-600" : "text-emerald-600"}`}>{summary ? `${summary.netPoints > 0 ? "+" : ""}${summary.netPoints}` : "—"}</strong></div>
      <div><p className="text-sm text-slate-500">日程得分 / 全部完成最高</p><strong className="text-2xl">{summary ? `${summary.schedulePoints} / ${summary.maximumSchedulePoints}` : "—"}</strong></div>
      <div className="text-sm text-slate-600"><p>目标奖励 {summary?.goalRewards ?? 0}</p><p>手动奖惩 {summary?.manualAdjustments ?? 0}</p></div>
      <SecondaryButton onClick={() => setShowClear(true)}>清除日程</SecondaryButton>
    </div>
    {actorMode === "parent" ? <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">家长代办会保留操作人审计，并按该任务冻结的规则写入学生积分流水。</p> : null}
    <ScheduleCalendar
      items={items}
      selectedDate={selectedDate}
      view={view}
      onDateChange={setSelectedDate}
      onViewChange={setView}
      renderActions={(item) => item.effectiveStatus === "pending" || item.effectiveStatus === "in_progress" ? <>
        {item.effectiveStatus === "pending" ? <button type="button" disabled={busyId === item.id} onClick={() => void run(item, "start")}>{actorMode === "parent" ? "代为开始" : "开始"}</button> : null}
        <button type="button" disabled={busyId === item.id} onClick={() => openCompletion(item)}>{actorMode === "parent" ? "代为完成" : "完成"}</button>
      </> : null}
    />
    {completing ? <Modal title={`${actorMode === "parent" ? "代为完成" : "完成"}：${completing.title}`} onClose={() => setCompleting(null)} layer="critical">
      <p className="mb-4 text-sm text-slate-600">填写真实执行时间，系统会按计划中的时限和积分条件自动计算。</p>
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm font-semibold">开始时间<input type="datetime-local" disabled={Boolean(completing.startedAt)} value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label>
        <div className="flex gap-2"><button type="button" aria-pressed={completionMode === "duration"} onClick={() => setCompletionMode("duration")}>填写时长</button><button type="button" aria-pressed={completionMode === "end"} onClick={() => setCompletionMode("end")}>填写结束时间</button></div>
        {completionMode === "duration" ? <label className="grid gap-2 text-sm font-semibold">完成时长（分钟）<input type="number" min="1" max="1440" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} /></label> : <label className="grid gap-2 text-sm font-semibold">结束时间<input type="datetime-local" value={completedAt} max={completionMaximum} onChange={(event) => setCompletedAt(event.target.value)} /></label>}
      </div>
      <div className="mt-5 flex justify-end gap-3"><SecondaryButton onClick={() => setCompleting(null)}>取消</SecondaryButton><PrimaryButton disabled={busyId === completing.id || !startedAt || (completionMode === "duration" ? Number(durationMinutes) <= 0 : !completedAt)} onClick={() => void run(completing, "complete", { startedAt: new Date(startedAt).toISOString(), ...(completionMode === "duration" ? { durationMinutes: Number(durationMinutes) } : { completedAt: new Date(completedAt).toISOString() }) })}>{actorMode === "parent" ? "确认代为完成并结算" : "确认完成并结算"}</PrimaryButton></div>
    </Modal> : null}
    {showClear ? <ClearScheduleDialog busy={busyId === "clear"} studentLimited onClose={() => setShowClear(false)} onConfirm={(from, through) => void confirmClear(from, through)} /> : null}
  </section>;
}
