"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ScheduleCalendar,
  rangeForCalendarDate,
  type CalendarView,
} from "@/components/schedule/schedule-calendar";
import { ClearScheduleDialog } from "@/components/schedule/clear-schedule-dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Modal } from "@/components/ui/modal";
import { PrimaryButton, SecondaryButton, TextInput, Toast } from "@/components/ui/page-shell";
import { ApiError } from "@/lib/client/api";
import {
  clearSchedule,
  completeScheduleItem,
  fetchPointsPeriodSummary,
  fetchScheduleItems,
  startPlanItem,
  updateTaskExecution,
  todayFamilyDate,
  type PointsPeriodSummaryDto,
  type ScheduleItemDto,
} from "@/lib/client/m2-api";

function toLocalInputValue(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function parseLocalInputValue(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

export function StudentScheduleWorkspace({
  studentId,
  actorMode = "student",
  selfSubject = false,
}: {
  studentId: string;
  actorMode?: "student" | "parent";
  /** Parent viewing/completing their own personal schedule (not acting for a student). */
  selfSubject?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [items, setItems] = useState<ScheduleItemDto[]>([]);
  const [summary, setSummary] = useState<PointsPeriodSummaryDto | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayFamilyDate());
  const [view, setView] = useState<CalendarView>("day");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completing, setCompleting] = useState<ScheduleItemDto | null>(null);
  const [homeworkItem, setHomeworkItem] = useState<ScheduleItemDto | null>(null);
  const [homeworkTitle, setHomeworkTitle] = useState("");
  const [homeworkDifficulty, setHomeworkDifficulty] = useState("");
  const [homeworkMinutes, setHomeworkMinutes] = useState("");
  const [completionMode, setCompletionMode] = useState<"end" | "duration">("duration");
  const [startedAt, setStartedAt] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [completionMaximum, setCompletionMaximum] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [showClear, setShowClear] = useState(false);

  const load = useCallback(
    async (date: string, calendarView: CalendarView) => {
      const range = rangeForCalendarDate(date, calendarView);
      setSummaryLoading(true);
      try {
        const [schedule, points] = await Promise.all([
          fetchScheduleItems(studentId, range.from, range.through),
          fetchPointsPeriodSummary(studentId, range.from, range.through),
        ]);
        setItems(schedule.items);
        setSummary(points);
      } finally {
        setSummaryLoading(false);
      }
    },
    [studentId],
  );

  useEffect(() => {
    void load(selectedDate, view).catch((cause) =>
      setError(cause instanceof ApiError ? cause.message : "加载日程失败"),
    );
  }, [load, selectedDate, view]);

  async function run(
    item: ScheduleItemDto,
    action: "start" | "complete",
    execution?: { startedAt?: string; completedAt?: string; durationMinutes?: number },
  ) {
    setBusyId(item.id);
    setError(null);
    setSummaryLoading(true);
    try {
      if (action === "start") await startPlanItem(item.id);
      else {
        if (execution?.durationMinutes !== undefined) {
          const start = parseLocalInputValue(startedAt);
          if (!start) {
            setError("开始时间格式不正确");
            setSummaryLoading(false);
            return;
          }
          const end = new Date(start.getTime() + execution.durationMinutes * 60_000);
          if (end.getTime() > Date.now()) {
            setError("开始时间加完成时长不能晚于当前时间，请缩短时长或调整开始时间");
            setSummaryLoading(false);
            return;
          }
        }
        await completeScheduleItem(item.id, execution);
        setCompleting(null);
      }
      setMessage(
        action === "start"
          ? selfSubject
            ? "已开始计时"
            : actorMode === "parent"
              ? "已由家长代为开始计时"
              : "已开始计时"
          : selfSubject
            ? "任务已完成并结算积分"
            : actorMode === "parent"
              ? "已由家长代为完成，积分已记录"
              : "任务已完成并结算积分",
      );
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "操作失败");
      setSummaryLoading(false);
    } finally {
      setBusyId(null);
    }
  }

  function openCompletion(item: ScheduleItemDto) {
    const start = item.startedAt ? new Date(item.startedAt) : new Date(Date.now() - 30 * 60_000);
    const end = new Date();
    const maximum = toLocalInputValue(end);
    setStartedAt(toLocalInputValue(start));
    setCompletedAt(maximum);
    setCompletionMaximum(maximum);
    setDurationMinutes(
      String(Math.max(1, Math.min(1440, Math.ceil((end.getTime() - start.getTime()) / 60_000)))),
    );
    setCompletionMode("duration");
    setCompleting(item);
  }

  async function toggleChecklist(item: ScheduleItemDto, taskId: string) {
    try {
      await updateTaskExecution(item.id, {
        checklist: (item.checklist ?? []).map((task) =>
          task.id === taskId ? { ...task, completed: !task.completed } : task,
        ),
      });
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "更新子任务失败");
    }
  }

  async function addHomeworkTask() {
    if (!homeworkItem || !homeworkTitle.trim()) return;
    try {
      await updateTaskExecution(homeworkItem.id, {
        checklist: [
          ...(homeworkItem.checklist ?? []),
          {
            id: `homework-${crypto.randomUUID()}`,
            title: homeworkTitle.trim(),
            completed: false,
            ...(homeworkDifficulty.trim() ? { difficulty: homeworkDifficulty.trim() } : {}),
            ...(Number(homeworkMinutes) > 0 ? { durationMinutes: Number(homeworkMinutes) } : {}),
          },
        ],
      });
      setHomeworkItem(null);
      setHomeworkTitle("");
      setHomeworkDifficulty("");
      setHomeworkMinutes("");
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "添加子学习任务失败");
    }
  }

  async function confirmClear(from: string, through: string) {
    setBusyId("clear");
    setError(null);
    try {
      const result = await clearSchedule(studentId, from, through);
      setMessage(`已清除 ${result.clearedCount} 项未开始日程`);
      setShowClear(false);
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "清除日程失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3" data-testid="student-schedule-workspace">
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={message} onClose={() => setMessage(null)} />
      <div className="flex flex-wrap items-stretch justify-between gap-3 rounded-3xl border border-[var(--bd-border)] bg-white p-4">
        <div>
          <p className="text-sm text-slate-500">
            {view === "day" ? "今日" : view === "week" ? "本周" : "本月"}积分净变动
            {summaryLoading ? "（更新中…）" : ""}
          </p>
          <strong
            className={`text-2xl ${summary && summary.netPoints < 0 ? "text-rose-600" : "text-emerald-600"}`}
            data-testid="schedule-net-points"
          >
            {summary ? `${summary.netPoints > 0 ? "+" : ""}${summary.netPoints}` : "—"}
          </strong>
        </div>
        <div>
          <p className="text-sm text-slate-500">日程得分 / 全部完成最高</p>
          <strong className="text-2xl" data-testid="schedule-points-summary">
            {summary ? `${summary.schedulePoints} / ${summary.maximumSchedulePoints}` : "—"}
          </strong>
        </div>
        <div className="text-sm text-slate-600">
          <p>目标奖励 {summary?.goalRewards ?? 0}</p>
          <p>手动奖惩 {summary?.manualAdjustments ?? 0}</p>
        </div>
        <SecondaryButton onClick={() => setShowClear(true)}>清除日程</SecondaryButton>
      </div>
      {actorMode === "parent" && !selfSubject ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          家长可开始/完成学生任务；代办会保留操作人审计，并按该任务冻结的规则写入学生积分流水。
        </p>
      ) : null}
      {selfSubject ? (
        <p className="rounded-2xl bg-[var(--bd-surface-soft)] px-4 py-3 text-sm text-slate-700">
          这是你本人的计划日程：开始/完成会按规则结算积分，仅用于个人记录，不进入学生兑换。
        </p>
      ) : null}
      <ScheduleCalendar
        items={items}
        selectedDate={selectedDate}
        view={view}
        onDateChange={setSelectedDate}
        onViewChange={setView}
        renderActions={(item) =>
          item.effectiveStatus === "pending" ||
          item.effectiveStatus === "in_progress" ||
          item.effectiveStatus === "completed" ? (
            <>
              {item.checklist?.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  disabled={busyId === item.id}
                  onClick={() => void toggleChecklist(item, task.id)}
                >
                  {task.completed ? `✓ ${task.title}` : `完成子任务：${task.title}`}
                </button>
              ))}
              {item.taskType === "homework" && item.effectiveStatus !== "completed" ? (
                <button type="button" onClick={() => setHomeworkItem(item)}>
                  添加子学习任务
                </button>
              ) : null}
              {item.taskType === "exercise" && item.effectiveStatus !== "completed" ? (
                <button
                  type="button"
                  onClick={() =>
                    void updateTaskExecution(item.id, {
                      pomodoroAction:
                        item.pomodoro?.state === "running"
                          ? "pause"
                          : item.pomodoro?.state === "paused"
                            ? "resume"
                            : "start",
                    }).then(() => load(selectedDate, view))
                  }
                >
                  {item.pomodoro?.state === "running"
                    ? "暂停番茄钟"
                    : item.pomodoro?.state === "paused"
                      ? "继续番茄钟"
                      : "开启番茄钟"}
                </button>
              ) : null}
              {item.effectiveStatus === "pending" ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void run(item, "start")}
                >
                  {actorMode === "parent" ? "开始" : "开始"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => openCompletion(item)}
              >
                完成
              </button>
              {item.effectiveStatus === "completed" ? (
                <span className="text-xs text-slate-500">可在编辑期限内调整子任务</span>
              ) : null}
            </>
          ) : null
        }
      />
      {completing ? (
        <Modal
          title={`${selfSubject || actorMode === "student" ? "完成" : "完成"}：${completing.title}`}
          onClose={() => setCompleting(null)}
          layer="normal"
        >
          <p className="mb-4 text-sm text-slate-600">
            填写真实执行时间。选择「填写时长」时不必再填结束时间；系统会按开始时间加时长结算。
          </p>
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              开始时间
              <input
                type="datetime-local"
                disabled={Boolean(completing.startedAt)}
                value={startedAt}
                onChange={(event) => setStartedAt(event.target.value)}
              />
            </label>
            <div
              className="bd-segmented-control"
              role="group"
              aria-label="完成时间填写方式"
              data-testid="schedule-completion-mode"
            >
              <button
                type="button"
                aria-pressed={completionMode === "duration"}
                onClick={() => setCompletionMode("duration")}
              >
                填写时长
              </button>
              <button
                type="button"
                aria-pressed={completionMode === "end"}
                onClick={() => {
                  setCompletionMaximum(toLocalInputValue(new Date()));
                  setCompletionMode("end");
                }}
              >
                填写结束时间
              </button>
            </div>
            {completionMode === "duration" ? (
              <label className="grid gap-2 text-sm font-semibold">
                完成时长（分钟）
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                />
              </label>
            ) : (
              <label className="grid gap-2 text-sm font-semibold">
                结束时间
                <input
                  type="datetime-local"
                  value={completedAt}
                  max={completionMaximum}
                  onChange={(event) => setCompletedAt(event.target.value)}
                />
              </label>
            )}
          </div>
          <div className="bd-modal-footer-actions">
            <SecondaryButton onClick={() => setCompleting(null)}>取消</SecondaryButton>
            <PrimaryButton
              disabled={
                busyId === completing.id ||
                !startedAt ||
                (completionMode === "duration" ? Number(durationMinutes) <= 0 : !completedAt)
              }
              onClick={() =>
                void run(completing, "complete", {
                  startedAt: parseLocalInputValue(startedAt)?.toISOString(),
                  ...(completionMode === "duration"
                    ? { durationMinutes: Number(durationMinutes) }
                    : { completedAt: parseLocalInputValue(completedAt)?.toISOString() }),
                })
              }
            >
              确认并完成结算
            </PrimaryButton>
          </div>
        </Modal>
      ) : null}
      {homeworkItem ? (
        <Modal
          title={`子学习任务：${homeworkItem.title}`}
          onClose={() => setHomeworkItem(null)}
          layer="normal"
        >
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              名称
              <TextInput
                value={homeworkTitle}
                onChange={(event) => setHomeworkTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              难度（可选）
              <TextInput
                value={homeworkDifficulty}
                onChange={(event) => setHomeworkDifficulty(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              耗时分钟（可选）
              <TextInput
                type="number"
                min="1"
                value={homeworkMinutes}
                onChange={(event) => setHomeworkMinutes(event.target.value)}
              />
            </label>
          </div>
          <div className="bd-modal-footer-actions">
            <SecondaryButton onClick={() => setHomeworkItem(null)}>取消</SecondaryButton>
            <PrimaryButton disabled={!homeworkTitle.trim()} onClick={() => void addHomeworkTask()}>
              添加
            </PrimaryButton>
          </div>
        </Modal>
      ) : null}
      {showClear ? (
        <ClearScheduleDialog
          busy={busyId === "clear"}
          studentLimited
          onClose={() => setShowClear(false)}
          onConfirm={(from, through) => void confirmClear(from, through)}
        />
      ) : null}
    </section>
  );
}
