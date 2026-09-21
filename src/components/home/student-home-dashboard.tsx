"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, LoadingState, PrimaryButton } from "@/components/ui/page-shell";
import {
  buildTrainingOptions,
  fetchOwnTrainingSummary,
  type SubjectTrainingSummary,
} from "@/lib/client/training-api";
import {
  fetchPointsBalance,
  fetchPointsPeriodSummary,
  fetchScheduleItems,
  scheduleStatusLabel,
  todayFamilyDate,
  type ScheduleItemDto,
} from "@/lib/client/m2-api";
import type { SessionInfo } from "@/lib/client/api";
import { HomeTaskIllustration } from "@/components/home/home-task-illustration";
import {
  formatScheduleTimeRange,
  pickNextScheduleItem,
  sortScheduleForDay,
} from "@/lib/schedule/home-schedule";

function greetingForHour(hour: number): string {
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function TaskRow({ item, highlight }: { item: ScheduleItemDto; highlight?: boolean }) {
  const done = item.effectiveStatus === "completed";
  return (
    <div
      className={`bd-task-row ${done ? "is-done" : ""} ${highlight ? "is-current" : ""}`}
      data-testid={`home-task-row-${item.id}`}
    >
      <span className="bd-task-status" aria-hidden="true">
        {done ? "✓" : ""}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="break-words">{item.title || item.planTitle}</h3>
        <p>
          {formatScheduleTimeRange(item)} · {scheduleStatusLabel(item.effectiveStatus)}
        </p>
      </div>
      {typeof item.pointsEarned === "number" && item.pointsEarned !== 0 ? (
        <span className="bd-points-earned">
          {item.pointsEarned > 0 ? "+" : ""}
          {item.pointsEarned}
        </span>
      ) : highlight ? (
        <span className="bd-row-label">接下来</span>
      ) : (
        <span className="bd-row-arrow" aria-hidden="true">
          →
        </span>
      )}
    </div>
  );
}

export function StudentHomeDashboard({ session }: { session: SessionInfo }) {
  const studentId = session.userId;
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ScheduleItemDto[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [todayNet, setTodayNet] = useState<number | null>(null);
  const [summaries, setSummaries] = useState<SubjectTrainingSummary[] | null>(null);
  const [trainingError, setTrainingError] = useState(false);
  const [scheduleError, setScheduleError] = useState(false);
  const [pointsError, setPointsError] = useState(false);
  const [staleSchedule, setStaleSchedule] = useState(false);
  const [stalePoints, setStalePoints] = useState(false);
  const requestId = useRef(0);
  const itemsRef = useRef(items);
  const balanceRef = useRef(balance);
  const todayNetRef = useRef(todayNet);
  itemsRef.current = items;
  balanceRef.current = balance;
  todayNetRef.current = todayNet;

  const today = todayFamilyDate();
  const displayName = session.displayName || session.account || "同学";

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setScheduleError(false);
    setPointsError(false);
    setTrainingError(false);

    const schedulePromise = fetchScheduleItems(studentId, today, today)
      .then((schedule) => {
        if (id !== requestId.current) return;
        setItems(schedule.items.filter((item) => item.familyDate === today));
        setStaleSchedule(false);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setScheduleError(true);
        setStaleSchedule(itemsRef.current.length > 0);
      });

    const pointsPromise = Promise.all([
      fetchPointsBalance(studentId),
      fetchPointsPeriodSummary(studentId, today, today),
    ])
      .then(([pointsBalance, period]) => {
        if (id !== requestId.current) return;
        setBalance(pointsBalance.balance);
        setTodayNet(period.netPoints);
        setStalePoints(false);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setPointsError(true);
        setStalePoints(balanceRef.current !== null || todayNetRef.current !== null);
      });

    const trainingPromise = Promise.all([
      fetchOwnTrainingSummary("reaction"),
      fetchOwnTrainingSummary("stroop"),
      fetchOwnTrainingSummary("digit-span"),
    ])
      .then((trainingRows) => {
        if (id !== requestId.current) return;
        setSummaries(trainingRows);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setTrainingError(true);
        setSummaries(null);
      });

    await Promise.all([schedulePromise, pointsPromise, trainingPromise]);
    if (id === requestId.current) setLoading(false);
  }, [studentId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => sortScheduleForDay(items), [items]);
  const nextItem = useMemo(() => pickNextScheduleItem(items), [items]);
  const completed = useMemo(
    () => items.filter((item) => item.effectiveStatus === "completed").length,
    [items],
  );
  const trainingOptions = buildTrainingOptions("/student/training");
  const hour = Number(
    new Date().toLocaleString("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Shanghai",
    }),
  );

  if (loading) {
    return (
      <div data-testid="student-home-dashboard">
        <LoadingState label="加载今日安排…" />
      </div>
    );
  }

  return (
    <div className="bd-home-dashboard" data-testid="student-home-dashboard">
      <header className="bd-home-greeting">
        <div>
          <h1 className="bd-home-title">
            {displayName}，{greetingForHour(hour)}
            <span className="bd-greeting-star" aria-hidden="true">
              ✦
            </span>
          </h1>
          <p className="bd-home-note">从眼前这一件小事开始。</p>
        </div>
        <div className="bd-day-progress">
          <div className="bd-progress-ring" aria-hidden="true">
            <span>
              {completed}
              <small> / {items.length || 0}</small>
            </span>
          </div>
          <span>
            今日已完成
            <strong>{items.length ? "继续按自己的节奏来" : "今天可以从一个小目标开始"}</strong>
          </span>
        </div>
      </header>

      {scheduleError ? (
        <Alert tone="error" className="mb-4" data-testid="home-schedule-error">
          今日安排暂时加载失败。{staleSchedule ? "以下为上次成功加载的数据。" : ""}{" "}
          <button type="button" className="bd-inline-link ml-2" onClick={() => void load()}>
            重试
          </button>
        </Alert>
      ) : null}

      <div className="bd-home-columns">
        <div className="bd-home-primary">
          <section
            className="bd-next-task bd-panel bd-next-task-with-art"
            data-testid="student-next-task"
          >
            {nextItem ? (
              <>
                <HomeTaskIllustration />
                <span className="bd-next-tag">
                  <span className="bd-status-dot" aria-hidden="true" />
                  下一项任务
                </span>
                <h2 className="break-words">{nextItem.title || nextItem.planTitle}</h2>
                <p className="bd-task-time">
                  {formatScheduleTimeRange(nextItem)}
                  {nextItem.planTitle ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      {nextItem.planTitle}
                    </>
                  ) : null}
                </p>
                {nextItem.description ? (
                  <p className="bd-task-description break-words">{nextItem.description}</p>
                ) : null}
                <PrimaryButton
                  type="button"
                  onClick={() => {
                    window.location.assign("/student/plans?view=schedule");
                  }}
                  data-testid="student-next-task-cta"
                >
                  查看日程 →
                </PrimaryButton>
              </>
            ) : (
              <>
                <span className="bd-next-tag">今日安排</span>
                <h2>{items.length ? "今天的任务都完成啦" : "今天还没有日程"}</h2>
                <p className="bd-task-description">
                  {items.length
                    ? "可以看看训练中心，或提前浏览明天的计划。"
                    : "去计划日程看看，或请家长为你安排学习计划。"}
                </p>
                <Link className="bd-inline-link" href="/student/plans?view=schedule">
                  打开计划日程 →
                </Link>
              </>
            )}
          </section>

          <section className="bd-today-section">
            <div className="bd-section-heading">
              <h2>
                今天的安排 <span>{items.length} 项</span>
              </h2>
              <Link className="bd-text-button" href="/student/plans?view=schedule">
                全部日程 <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="bd-panel bd-task-list">
              {sorted.length ? (
                sorted.map((item) => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    highlight={nextItem?.id === item.id && item.effectiveStatus !== "completed"}
                  />
                ))
              ) : (
                <div className="bd-empty">
                  <span aria-hidden="true">📅</span>
                  <h3>今天还没有安排</h3>
                  <p>制定或启用计划后，任务会出现在这里。</p>
                  <Link className="bd-inline-link" href="/student/plans">
                    去我的计划 →
                  </Link>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="bd-home-secondary">
          <section className="bd-points-panel bd-panel">
            <div className="bd-section-heading">
              <h2>一点点积累</h2>
            </div>
            {pointsError ? (
              <Alert tone="error" data-testid="home-points-error">
                积分数据暂时不可用。{stalePoints ? "以下为上次成功加载的数据。" : ""}{" "}
                <button type="button" className="bd-inline-link" onClick={() => void load()}>
                  重试
                </button>
              </Alert>
            ) : null}
            <div className="bd-points-value" data-testid="home-points-balance">
              {balance === null ? "—" : balance}
              <span>积分余额</span>
            </div>
            <div className="bd-points-bottom">
              <span>
                今日 <b>{todayNet === null ? "—" : todayNet > 0 ? `+${todayNet}` : todayNet}</b>
              </span>
              <Link className="bd-text-button" href="/student/redemption">
                查看记录 ↗
              </Link>
            </div>
          </section>

          <p className="bd-gentle-note">
            <span aria-hidden="true">✦</span> 不和别人比，记录自己的每一步。
          </p>
          <section className="bd-training-panel bd-panel">
            <div className="bd-section-heading">
              <h2>换个方式，动动脑</h2>
            </div>
            <p className="bd-caption">选一项喜欢的练习。</p>
            {trainingError ? (
              <Alert tone="error">训练近况加载失败</Alert>
            ) : !summaries ? (
              <LoadingState label="加载训练…" />
            ) : (
              <div className="bd-training-links">
                {trainingOptions.map((option, index) => {
                  const last = summaries[index]?.lastSession;
                  const subtitle = last?.finishedAt
                    ? `最近 · ${new Date(last.finishedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                    : "来试试自己的节奏";
                  return (
                    <Link key={option.key} href={option.href} className="bd-training-link">
                      <span className="bd-training-link-icon" aria-hidden="true">
                        {["⚡", "🎨", "🔢"][index]}
                      </span>
                      <span>
                        <strong>{option.title}</strong>
                        <small>{subtitle}</small>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
