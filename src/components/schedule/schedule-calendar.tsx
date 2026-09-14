"use client";

import type { ReactNode } from "react";

import { scheduleStatusLabel, todayFamilyDate, type ScheduleItemDto } from "@/lib/client/m2-api";

export type CalendarView = "day" | "week" | "month";

function parseFamilyDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatFamilyDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function rangeForCalendarDate(date: string, view: CalendarView) {
  const base = parseFamilyDate(date);
  if (view === "day") return { from: date, through: date };
  if (view === "week") {
    const offset = base.getUTCDay();
    base.setUTCDate(base.getUTCDate() - offset);
    const through = new Date(base);
    through.setUTCDate(through.getUTCDate() + 6);
    return { from: formatFamilyDate(base), through: formatFamilyDate(through) };
  }
  const from = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const gridFrom = new Date(from);
  gridFrom.setUTCDate(gridFrom.getUTCDate() - gridFrom.getUTCDay());
  const through = new Date(gridFrom);
  through.setUTCDate(through.getUTCDate() + 41);
  return { from: formatFamilyDate(gridFrom), through: formatFamilyDate(through) };
}

export function moveCalendarDate(date: string, view: CalendarView, direction: -1 | 1) {
  const next = parseFamilyDate(date);
  if (view === "day") next.setUTCDate(next.getUTCDate() + direction);
  else if (view === "week") next.setUTCDate(next.getUTCDate() + direction * 7);
  else next.setUTCMonth(next.getUTCMonth() + direction);
  return formatFamilyDate(next);
}

function dateLabel(date: string, view: CalendarView) {
  const value = parseFamilyDate(date);
  if (view === "day") return `${value.getUTCFullYear()}年${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
  if (view === "week") {
    const { from, through } = rangeForCalendarDate(date, view);
    return `${Number(from.slice(5, 7))}月${Number(from.slice(8))}日 – ${Number(through.slice(5, 7))}月${Number(through.slice(8))}日`;
  }
  return `${value.getUTCFullYear()}年${value.getUTCMonth() + 1}月`;
}

function itemTime(item: ScheduleItemDto) {
  return new Date(item.scheduledAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

function EventCard({ item, compact = false, actions }: { item: ScheduleItemDto; compact?: boolean; actions?: ReactNode }) {
  return (
    <article className={`bd-calendar-event bd-calendar-event-${item.effectiveStatus} ${compact ? "is-compact" : ""}`} data-testid={`student-schedule-item-${item.id}`}>
      <div><time>{itemTime(item)}</time><strong>{item.title || item.planTitle || "计划任务"}</strong></div>
      {!compact ? <p>{item.planTitle} · {scheduleStatusLabel(item.effectiveStatus)} · 优先级 {item.priority}</p> : null}
      {actions ? <div className="bd-calendar-event-actions">{actions}</div> : null}
    </article>
  );
}

function datesBetween(from: string, count: number) {
  const start = parseFamilyDate(from);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return formatFamilyDate(date);
  });
}

export function ScheduleCalendar({
  items,
  selectedDate,
  view,
  onDateChange,
  onViewChange,
  renderActions,
}: {
  items: ScheduleItemDto[];
  selectedDate: string;
  view: CalendarView;
  onDateChange: (date: string) => void;
  onViewChange: (view: CalendarView) => void;
  renderActions?: (item: ScheduleItemDto) => ReactNode;
}) {
  const range = rangeForCalendarDate(selectedDate, view);
  const byDate = new Map<string, ScheduleItemDto[]>();
  for (const item of items) byDate.set(item.familyDate, [...(byDate.get(item.familyDate) ?? []), item]);
  const today = todayFamilyDate();
  return (
    <section className="bd-calendar" data-testid={`schedule-calendar-${view}`}>
      <header className="bd-calendar-toolbar">
        <button type="button" onClick={() => onDateChange(today)}>今天</button>
        <button type="button" aria-label="上一段日期" onClick={() => onDateChange(moveCalendarDate(selectedDate, view, -1))}>‹</button>
        <button type="button" aria-label="下一段日期" onClick={() => onDateChange(moveCalendarDate(selectedDate, view, 1))}>›</button>
        <label className="bd-calendar-date-title">{dateLabel(selectedDate, view)}<input aria-label="选择日期" type="date" value={selectedDate} onChange={(event) => onDateChange(event.target.value)} /></label>
        <div className="bd-calendar-view-tabs" aria-label="日程查看方式">
          {(["day", "week", "month"] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={view === candidate} onClick={() => onViewChange(candidate)}>{candidate === "day" ? "日" : candidate === "week" ? "周" : "月"}</button>)}
        </div>
      </header>
      {view === "day" ? (
        <div className="bd-calendar-day">
          <div className="bd-calendar-day-heading"><span>GMT+8</span><strong>{selectedDate === today ? "今天" : `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8))}日`}</strong></div>
          {Array.from({ length: 24 }, (_, index) => index).map((hour) => {
            const rowItems = (byDate.get(selectedDate) ?? []).filter((item) => Number(itemTime(item).slice(0, 2)) === hour);
            return <div className="bd-calendar-hour" key={hour}><time>{String(hour).padStart(2, "0")}:00</time><div>{rowItems.map((item) => <EventCard key={item.id} item={item} actions={renderActions?.(item)} />)}</div></div>;
          })}
        </div>
      ) : view === "week" ? (
        <div className="bd-calendar-scroll"><div className="bd-calendar-week">
          <div className="bd-calendar-week-heading"><span>GMT+8</span>{datesBetween(range.from, 7).map((date, index) => <header className={date === today ? "is-today" : ""} key={date}><span>{["周日", "周一", "周二", "周三", "周四", "周五", "周六"][index]}</span><strong>{Number(date.slice(8))}</strong></header>)}</div>
          <div className="bd-calendar-week-hours">
            {Array.from({ length: 24 }, (_, index) => index).map((hour) => <div className="bd-calendar-week-row" key={hour}>
              <time>{String(hour).padStart(2, "0")}:00</time>
              {datesBetween(range.from, 7).map((date) => <div className={date === today ? "is-today" : ""} key={date}>{(byDate.get(date) ?? []).filter((item) => Number(itemTime(item).slice(0, 2)) === hour).map((item) => <EventCard key={item.id} item={item} compact actions={renderActions?.(item)} />)}</div>)}
            </div>)}
          </div>
        </div></div>
      ) : (
        <div className="bd-calendar-month">
          {["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map((day) => <strong className="bd-calendar-weekday" key={day}>{day}</strong>)}
          {datesBetween(range.from, 42).map((date) => <section className={`${date.slice(0, 7) !== selectedDate.slice(0, 7) ? "is-outside" : ""} ${date === today ? "is-today" : ""}`} key={date}><time>{Number(date.slice(8))}</time><div>{(byDate.get(date) ?? []).slice(0, 5).map((item) => <EventCard key={item.id} item={item} compact />)}{(byDate.get(date)?.length ?? 0) > 5 ? <small>另有 {(byDate.get(date)?.length ?? 0) - 5} 项</small> : null}</div></section>)}
        </div>
      )}
    </section>
  );
}
