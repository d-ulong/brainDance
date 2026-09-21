"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { todayFamilyDate, type ScheduleItemDto } from "@/lib/client/m2-api";

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
  if (view === "day")
    return `${value.getUTCFullYear()}年${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
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

function EventCard({
  item,
  compact = false,
  actions,
}: {
  item: ScheduleItemDto;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const earned = item.pointsEarned;
  const showPoints = typeof earned === "number" && earned !== 0;
  const pointsInline = showPoints
    ? ` · ${earned > 0 ? "+" : ""}${earned}${item.pointsRuleLabel ? ` · ${item.pointsRuleLabel}` : ""}`
    : "";
  return (
    <article
      className={`bd-calendar-event bd-calendar-event-${item.effectiveStatus} ${compact ? "is-compact" : ""}`}
      data-testid={`student-schedule-item-${item.id}`}
    >
      <div className="w-full text-left">
        <div>
          <time>{itemTime(item)}</time>
          <strong>
            {item.title || item.planTitle || "计划任务"}
            {pointsInline ? (
              <span className="font-semibold text-slate-600">{pointsInline}</span>
            ) : null}
          </strong>
        </div>
        {!compact && item.planTitle && item.title ? (
          <p className="text-xs text-slate-500">{item.planTitle}</p>
        ) : null}
        {!compact && item.description ? (
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{item.description}</p>
        ) : null}
        {!compact && item.completionStandard ? (
          <p className="mt-1 text-xs font-semibold text-[var(--bd-primary)]">
            完成标准：{item.completionStandard}
          </p>
        ) : null}
        {!compact && item.taskType === "exercise" ? (
          <p className="mt-1 text-xs text-slate-500">运动分析暂未开放；可记录执行时间。</p>
        ) : null}
        {!compact && item.checklist?.length ? (
          <p className="mt-1 text-xs text-slate-600">
            子任务：{item.checklist.filter((task) => task.completed).length}/{item.checklist.length}{" "}
            已完成
          </p>
        ) : null}
      </div>
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
  for (const item of items)
    byDate.set(item.familyDate, [...(byDate.get(item.familyDate) ?? []), item]);
  const today = todayFamilyDate();
  const dayItems = [...(byDate.get(selectedDate) ?? [])].sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  );
  const dayScrollRef = useRef<HTMLDivElement>(null);
  const weekDates = datesBetween(range.from, 7);
  const monthDates = datesBetween(range.from, 42);

  useEffect(() => {
    if (view !== "day") return;
    const container = dayScrollRef.current;
    if (!container) return;
    const currentHour = Number(
      new Date().toLocaleString("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: "Asia/Shanghai",
      }),
    );
    const earliestItemHour = dayItems.length
      ? Math.min(...dayItems.map((item) => Number(itemTime(item).slice(0, 2))))
      : currentHour;
    const targetHour = Math.min(23, Math.max(0, earliestItemHour, currentHour));
    const row = container.querySelector<HTMLElement>(`[data-hour="${targetHour}"]`);
    row?.scrollIntoView({ block: "start" });
  }, [dayItems, selectedDate, view]);

  return (
    <section
      className="bd-calendar"
      data-testid={`schedule-calendar-${view}`}
      data-mobile-layout={view}
    >
      <header className="bd-calendar-toolbar">
        <button type="button" onClick={() => onDateChange(today)}>
          今天
        </button>
        <button
          type="button"
          aria-label="上一段日期"
          onClick={() => onDateChange(moveCalendarDate(selectedDate, view, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="下一段日期"
          onClick={() => onDateChange(moveCalendarDate(selectedDate, view, 1))}
        >
          ›
        </button>
        <label className="bd-calendar-date-title">
          {dateLabel(selectedDate, view)}
          <input
            aria-label="选择日期"
            type="date"
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </label>
        <div className="bd-calendar-view-tabs" aria-label="日程查看方式">
          {(["day", "week", "month"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => onViewChange(candidate)}
            >
              {candidate === "day" ? "日" : candidate === "week" ? "周" : "月"}
            </button>
          ))}
        </div>
      </header>
      <div className="bd-mobile-schedule-list" data-testid="schedule-mobile-day-list">
        <h3>
          {selectedDate === today
            ? "今天"
            : `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8))}日`}
          · {dayItems.length} 项
        </h3>
        {dayItems.length ? (
          dayItems.map((item) => (
            <div key={item.id} className="bd-mobile-schedule-row">
              <EventCard item={item} actions={renderActions?.(item)} />
            </div>
          ))
        ) : (
          <p className="text-sm text-[var(--bd-muted)]">这一天还没有日程。</p>
        )}
      </div>
      <div className="bd-mobile-calendar-week" data-testid="schedule-mobile-week">
        {weekDates.map((date) => {
          const count = byDate.get(date)?.length ?? 0;
          return (
            <button
              key={date}
              type="button"
              className={date === today ? "is-today" : ""}
              aria-pressed={date === selectedDate}
              onClick={() => onDateChange(date)}
            >
              <span>
                {["日", "一", "二", "三", "四", "五", "六"][parseFamilyDate(date).getUTCDay()]}
              </span>
              <strong>{Number(date.slice(8))}</strong>
              <small>{count} 项</small>
            </button>
          );
        })}
      </div>
      <div className="bd-mobile-calendar-month" data-testid="schedule-mobile-month">
        {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
          <strong key={label} className="text-center text-xs text-[var(--bd-muted)]">
            {label}
          </strong>
        ))}
        {monthDates.map((date) => {
          const count = byDate.get(date)?.length ?? 0;
          const outside = date.slice(0, 7) !== selectedDate.slice(0, 7);
          return (
            <button
              key={date}
              type="button"
              className={`${outside ? "is-outside" : ""} ${date === today ? "is-today" : ""}`}
              aria-pressed={date === selectedDate}
              onClick={() => onDateChange(date)}
            >
              {Number(date.slice(8))}
              {count ? <small className="block text-[0.6rem]">{count}</small> : null}
            </button>
          );
        })}
      </div>
      {view === "day" ? (
        <div className="bd-calendar-day bd-calendar-day-scroll" ref={dayScrollRef}>
          <div className="bd-calendar-day-heading">
            <span>GMT+8</span>
            <strong>
              {selectedDate === today
                ? "今天"
                : `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8))}日`}
            </strong>
          </div>
          {Array.from({ length: 24 }, (_, index) => index).map((hour) => {
            const rowItems = (byDate.get(selectedDate) ?? []).filter(
              (item) => Number(itemTime(item).slice(0, 2)) === hour,
            );
            return (
              <div className="bd-calendar-hour" key={hour} data-hour={hour}>
                <time>{String(hour).padStart(2, "0")}:00</time>
                <div>
                  {rowItems.map((item) => (
                    <EventCard key={item.id} item={item} actions={renderActions?.(item)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === "week" ? (
        <div className="bd-calendar-scroll">
          <div className="bd-calendar-week">
            <div className="bd-calendar-week-heading">
              <span>GMT+8</span>
              {datesBetween(range.from, 7).map((date, index) => (
                <header className={date === today ? "is-today" : ""} key={date}>
                  <span>{["周日", "周一", "周二", "周三", "周四", "周五", "周六"][index]}</span>
                  <strong>{Number(date.slice(8))}</strong>
                </header>
              ))}
            </div>
            <div className="bd-calendar-week-hours">
              {Array.from({ length: 24 }, (_, index) => index).map((hour) => (
                <div className="bd-calendar-week-row" key={hour}>
                  <time>{String(hour).padStart(2, "0")}:00</time>
                  {datesBetween(range.from, 7).map((date) => (
                    <div className={date === today ? "is-today" : ""} key={date}>
                      {(byDate.get(date) ?? [])
                        .filter((item) => Number(itemTime(item).slice(0, 2)) === hour)
                        .map((item) => (
                          <EventCard
                            key={item.id}
                            item={item}
                            compact
                            actions={renderActions?.(item)}
                          />
                        ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bd-calendar-month">
          {["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map((day) => (
            <strong className="bd-calendar-weekday" key={day}>
              {day}
            </strong>
          ))}
          {datesBetween(range.from, 42).map((date) => {
            const monthItems = byDate.get(date) ?? [];
            return (
              <section
                className={`${date.slice(0, 7) !== selectedDate.slice(0, 7) ? "is-outside" : ""} ${date === today ? "is-today" : ""}`}
                key={date}
                data-testid={`schedule-month-day-${date}`}
                tabIndex={monthItems.length ? 0 : undefined}
                aria-label={
                  monthItems.length
                    ? `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日，共 ${monthItems.length} 项日程；悬停或聚焦可查看全部任务。`
                    : undefined
                }
              >
                <time>{Number(date.slice(8))}</time>
                <div>
                  {monthItems.slice(0, 4).map((item) => (
                    <EventCard key={item.id} item={item} compact />
                  ))}
                  {monthItems.length > 4 ? <small>另有 {monthItems.length - 4} 项</small> : null}
                </div>
                {monthItems.length ? (
                  <div className="bd-calendar-month-popover" role="tooltip">
                    <strong>
                      {Number(date.slice(5, 7))}月{Number(date.slice(8))}日 · 全部日程
                    </strong>
                    {monthItems.map((item) => (
                      <EventCard key={item.id} item={item} compact />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
