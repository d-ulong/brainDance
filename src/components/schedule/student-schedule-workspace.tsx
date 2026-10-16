"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ScheduleCalendar,
  rangeForCalendarDate,
  rangeForCalendarSummary,
  type CalendarView,
} from "@/components/schedule/schedule-calendar";
import { ClearScheduleDialog } from "@/components/schedule/clear-schedule-dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { PrimaryButton, SecondaryButton, TextInput, Toast } from "@/components/ui/page-shell";
import { ApiError } from "@/lib/client/api";
import {
  familyInputValue as toLocalInputValue,
  parseFamilyInput as parseLocalInputValue,
  finalTimerFromInputs,
} from "@/lib/schedule/execution-timer";
import {
  clearSchedule,
  completeScheduleItem,
  correctScheduleItem,
  fetchPointsPeriodSummary,
  fetchScheduleItems,
  startPlanItem,
  updateTaskExecution,
  todayFamilyDate,
  type PointsPeriodSummaryDto,
  type ScheduleItemDto,
  type ChecklistTaskDto,
  type TaskTimerDto,
} from "@/lib/client/m2-api";

function TimerCorrectionFields({
  enabled,
  onEnabled,
  start,
  onStart,
  stop,
  onStop,
  paused,
  onPaused,
  count,
  onCount,
  timer,
}: {
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  start: string;
  onStart: (value: string) => void;
  stop: string;
  onStop: (value: string) => void;
  paused: string;
  onPaused: (value: string) => void;
  count: string;
  onCount: (value: string) => void;
  timer: TaskTimerDto | null;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend>专注计时记录</legend>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        保留专注计时记录
      </label>
      {enabled ? (
        <>
          <label className="grid gap-1">
            计时开始（北京时间）
            <input
              type="datetime-local"
              step="1"
              value={start}
              onChange={(event) => onStart(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            计时结束（北京时间）
            <input
              type="datetime-local"
              step="1"
              value={stop}
              onChange={(event) => onStop(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            暂停分钟
            <input
              type="number"
              min="0"
              step="any"
              value={paused}
              onChange={(event) => onPaused(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            暂停次数
            <input
              type="number"
              min="0"
              step="1"
              value={count}
              onChange={(event) => onCount(event.target.value)}
            />
          </label>
          <p className="text-sm">
            专注时长：
            <output>
              {timer
                ? `${Math.floor((timer.focusedSeconds ?? 0) / 60)}分${(timer.focusedSeconds ?? 0) % 60}秒`
                : "请检查计时区间与暂停时长"}
            </output>
          </p>
          <p className="text-xs text-[var(--bd-muted)]">专注时长按计时区间减去暂停时间自动计算。</p>
        </>
      ) : (
        <p className="text-xs text-[var(--bd-muted)]">
          本次更正将不保留专注计时，原记录仍在历史版本中。
        </p>
      )}
    </fieldset>
  );
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
  const [taskStartedAt, setTaskStartedAt] = useState("");
  const [taskCompletedAt, setTaskCompletedAt] = useState("");
  const [includeTimer, setIncludeTimer] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState("");
  const [timerStoppedAt, setTimerStoppedAt] = useState("");
  const [includeTaskTimer, setIncludeTaskTimer] = useState(false);
  const [taskTimerStartedAt, setTaskTimerStartedAt] = useState("");
  const [taskTimerStoppedAt, setTaskTimerStoppedAt] = useState("");
  const [taskPausedMinutes, setTaskPausedMinutes] = useState("");
  const [taskPauseCount, setTaskPauseCount] = useState("");
  const [deletingTask, setDeletingTask] = useState<{
    item: ScheduleItemDto;
    task: ChecklistTaskDto;
  } | null>(null);
  const [pausedMinutes, setPausedMinutes] = useState("");
  const [pauseCount, setPauseCount] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [completionMode, setCompletionMode] = useState<"end" | "duration">("duration");
  const [startedAt, setStartedAt] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [completionMaximum, setCompletionMaximum] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [showClear, setShowClear] = useState(false);
  const loadSequence = useRef(0);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const finalTimer = finalTimerFromInputs(
    timerStartedAt,
    timerStoppedAt,
    pausedMinutes,
    pauseCount,
  );
  const finalTaskTimer = finalTimerFromInputs(
    taskTimerStartedAt,
    taskTimerStoppedAt,
    taskPausedMinutes,
    taskPauseCount,
  );

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const date = query.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setSelectedDate(date);
    setFocusItemId(query.get("item"));
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!focusItemId || !items.some((item) => item.id === focusItemId)) return;
    const card = Array.from(document.querySelectorAll<HTMLElement>("[data-schedule-item-id]")).find(
      (candidate) =>
        candidate.dataset.scheduleItemId === focusItemId && candidate.getClientRects().length > 0,
    );
    card?.scrollIntoView({ block: "center" });
    card?.focus({ preventScroll: true });
    if (card) setFocusItemId(null);
  }, [items, focusItemId]);

  const load = useCallback(
    async (date: string, calendarView: CalendarView) => {
      const range = rangeForCalendarDate(date, calendarView);
      const summaryRange = rangeForCalendarSummary(date, calendarView);
      const request = ++loadSequence.current;
      setSummaryLoading(true);
      try {
        const [schedule, points] = await Promise.all([
          fetchScheduleItems(studentId, range.from, range.through),
          fetchPointsPeriodSummary(studentId, summaryRange.from, summaryRange.through),
        ]);
        if (request === loadSequence.current) {
          setItems(schedule.items);
          setSummary(points);
        }
      } finally {
        if (request === loadSequence.current) setSummaryLoading(false);
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
        if (item.effectiveStatus === "completed") {
          if (includeTimer && !finalTimer) {
            setError("请填写有效的计时区间、暂停分钟和暂停次数");
            setSummaryLoading(false);
            return;
          }
          await correctScheduleItem(item.id, {
            ...execution,
            expectedRevision: item.executionRevision ?? 0,
            reason: correctionReason.trim(),
            pomodoro: includeTimer ? (finalTimer ?? undefined) : {},
          });
        } else await completeScheduleItem(item.id, execution);
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
            ? "任务已保存，积分已更新"
            : actorMode === "parent"
              ? "已由家长代为完成，积分已记录"
              : "任务已保存，积分已更新",
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
    const end = item.completedAt ? new Date(item.completedAt) : new Date();
    const maximum = toLocalInputValue(new Date());
    setStartedAt(toLocalInputValue(start));
    setCompletedAt(toLocalInputValue(end));
    setCompletionMaximum(maximum);
    setDurationMinutes(
      String(Math.max(1, Math.min(1440, Math.ceil((end.getTime() - start.getTime()) / 60_000)))),
    );
    setCompletionMode(item.effectiveStatus === "completed" ? "end" : "duration");
    setCorrectionReason("");
    setIncludeTimer(Boolean(item.pomodoro?.state));
    setTimerStartedAt(toLocalInputValue(new Date(item.pomodoro?.startedAt ?? start)));
    setTimerStoppedAt(toLocalInputValue(new Date(item.pomodoro?.stoppedAt ?? end)));
    setPausedMinutes(String((item.pomodoro?.pausedSeconds ?? 0) / 60));
    setPauseCount(String(item.pomodoro?.pauseCount ?? 0));
    setCompleting(item);
  }

  async function toggleChecklist(item: ScheduleItemDto, taskId: string) {
    setBusyId(item.id);
    try {
      await updateTaskExecution(item.id, {
        expectedRevision: item.executionRevision ?? 0,
        reason: "调整子任务完成状态",
        checklist: (item.checklist ?? []).map((task) =>
          task.id === taskId ? { ...task, completed: !task.completed } : task,
        ),
      });
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "更新子任务失败");
    } finally {
      setBusyId(null);
    }
  }

  async function addHomeworkTask() {
    if (!homeworkItem || !homeworkTitle.trim()) return;
    setBusyId(homeworkItem.id);
    try {
      if (homeworkItem.effectiveStatus === "completed" && includeTaskTimer && !finalTaskTimer) {
        setError("请填写有效的子任务计时区间、暂停分钟和暂停次数");
        return;
      }
      const original = homeworkItem.checklist?.find((task) => task.id === editingTaskId);
      const task: ChecklistTaskDto = {
        ...original,
        id: editingTaskId ?? `homework-${crypto.randomUUID()}`,
        title: homeworkTitle.trim(),
        completed: original?.completed ?? false,
        startedAt: taskStartedAt ? parseLocalInputValue(taskStartedAt)?.toISOString() : undefined,
        completedAt: taskCompletedAt
          ? parseLocalInputValue(taskCompletedAt)?.toISOString()
          : undefined,
        ...(homeworkItem.effectiveStatus === "completed"
          ? { pomodoro: includeTaskTimer ? (finalTaskTimer ?? undefined) : {} }
          : {}),
        difficulty: homeworkDifficulty.trim() || undefined,
        durationMinutes: Number(homeworkMinutes) > 0 ? Number(homeworkMinutes) : undefined,
      };
      await updateTaskExecution(homeworkItem.id, {
        expectedRevision: homeworkItem.executionRevision ?? 0,
        reason: "调整子学习任务内容",
        checklist: editingTaskId
          ? (homeworkItem.checklist ?? []).map((entry) =>
              entry.id === editingTaskId ? task : entry,
            )
          : [...(homeworkItem.checklist ?? []), task],
      });
      setHomeworkItem(null);
      setHomeworkTitle("");
      setHomeworkDifficulty("");
      setHomeworkMinutes("");
      setEditingTaskId(null);
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存子任务失败");
    } finally {
      setBusyId(null);
    }
  }

  function openTaskEditor(item: ScheduleItemDto, task?: ChecklistTaskDto) {
    setHomeworkItem(item);
    setEditingTaskId(task?.id ?? null);
    setHomeworkTitle(task?.title ?? "");
    setHomeworkDifficulty(task?.difficulty ?? "");
    setHomeworkMinutes(task?.durationMinutes?.toString() ?? "");
    setTaskStartedAt(task?.startedAt ? toLocalInputValue(new Date(task.startedAt)) : "");
    setTaskCompletedAt(task?.completedAt ? toLocalInputValue(new Date(task.completedAt)) : "");
    setIncludeTaskTimer(Boolean(task?.pomodoro?.state));
    setTaskTimerStartedAt(
      task?.pomodoro?.startedAt
        ? toLocalInputValue(new Date(task.pomodoro.startedAt))
        : task?.startedAt
          ? toLocalInputValue(new Date(task.startedAt))
          : "",
    );
    setTaskTimerStoppedAt(
      task?.pomodoro?.stoppedAt
        ? toLocalInputValue(new Date(task.pomodoro.stoppedAt))
        : task?.completedAt
          ? toLocalInputValue(new Date(task.completedAt))
          : "",
    );
    setTaskPausedMinutes(String((task?.pomodoro?.pausedSeconds ?? 0) / 60));
    setTaskPauseCount(String(task?.pomodoro?.pauseCount ?? 0));
  }

  async function deleteHomeworkTask() {
    if (!deletingTask) return;
    const { item, task } = deletingTask;
    setBusyId(item.id);
    try {
      await updateTaskExecution(item.id, {
        expectedRevision: item.executionRevision ?? 0,
        reason: "删除作业子学习任务",
        checklist: (item.checklist ?? []).filter((entry) => entry.id !== task.id),
      });
      setDeletingTask(null);
      if (editingTaskId === task.id) setHomeworkItem(null);
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "删除子任务失败");
    } finally {
      setBusyId(null);
    }
  }

  async function changeTimer(
    item: ScheduleItemDto,
    timer: TaskTimerDto | undefined,
    subtaskId?: string,
    stop = false,
  ) {
    setBusyId(item.id);
    try {
      await updateTaskExecution(item.id, {
        expectedRevision: item.executionRevision ?? 0,
        subtaskId,
        pomodoroAction: stop
          ? "stop"
          : timer?.state === "running"
            ? "pause"
            : timer?.state === "paused"
              ? "resume"
              : "start",
      });
      await load(selectedDate, view);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "计时更新失败，请重试");
    } finally {
      setBusyId(null);
    }
  }

  function timerLabel(timer?: TaskTimerDto) {
    if (!timer?.startedAt) return "开启专注计时";
    const until = timer.state === "paused" ? timer.pausedAt : timer.stoppedAt;
    const seconds =
      timer.state === "stopped"
        ? (timer.focusedSeconds ?? 0)
        : Math.max(
            0,
            Math.floor(
              ((until ? new Date(until).getTime() : clock) - new Date(timer.startedAt).getTime()) /
                1000,
            ) - (timer.pausedSeconds ?? 0),
          );
    return `${timer.state === "running" ? "暂停" : timer.state === "paused" ? "继续" : "已结束"} · ${Math.floor(seconds / 60)}分${seconds % 60}秒`;
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
          你可以陪孩子开始或完成任务。修改已完成记录时会保留原记录，并更新相应积分。
        </p>
      ) : null}
      {selfSubject ? (
        <p className="rounded-2xl bg-[var(--bd-surface-soft)] px-4 py-3 text-sm text-slate-700">
          这是你本人的计划日程，完成后按创建时的规则获得积分。
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
                <div key={task.id} className="bd-checklist-task">
                  <button
                    type="button"
                    disabled={busyId === item.id || !item.canEditExecution}
                    aria-pressed={task.completed}
                    onClick={() => void toggleChecklist(item, task.id)}
                  >
                    {task.completed ? `✓ ${task.title}` : `完成子任务：${task.title}`}
                  </button>
                  <span className="text-xs text-[var(--bd-muted)]">
                    {[task.difficulty, task.durationMinutes ? `${task.durationMinutes}分钟` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {item.canEditExecution ? (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => openTaskEditor(item, task)}
                    >
                      修改子任务
                    </button>
                  ) : null}
                  {item.taskType === "homework" && item.canEditExecution ? (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => setDeletingTask({ item, task })}
                    >
                      删除子任务
                    </button>
                  ) : null}
                  {item.taskType === "homework" &&
                  item.canEditExecution &&
                  item.effectiveStatus !== "completed" ? (
                    <button
                      type="button"
                      disabled={busyId === item.id || task.pomodoro?.state === "stopped"}
                      onClick={() => void changeTimer(item, task.pomodoro, task.id)}
                    >
                      {timerLabel(task.pomodoro)}
                    </button>
                  ) : null}
                  {task.pomodoro?.state &&
                  task.pomodoro.state !== "stopped" &&
                  item.canEditExecution &&
                  item.effectiveStatus !== "completed" ? (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void changeTimer(item, task.pomodoro, task.id, true)}
                    >
                      结束子任务计时
                    </button>
                  ) : null}
                  {task.pomodoro?.state === "stopped" ? (
                    <span className="text-xs">{timerLabel(task.pomodoro)}</span>
                  ) : null}
                </div>
              ))}
              {item.taskType === "homework" && item.canEditExecution ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => openTaskEditor(item)}
                >
                  添加子学习任务
                </button>
              ) : null}
              {(item.taskType === "exercise" || item.taskType === "homework") &&
              item.canEditExecution &&
              item.effectiveStatus !== "completed" ? (
                <button
                  type="button"
                  disabled={busyId === item.id || item.pomodoro?.state === "stopped"}
                  onClick={() => void changeTimer(item, item.pomodoro)}
                >
                  {timerLabel(item.pomodoro)}
                </button>
              ) : null}
              {item.pomodoro?.state &&
              item.pomodoro.state !== "stopped" &&
              item.canEditExecution &&
              item.effectiveStatus !== "completed" ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void changeTimer(item, item.pomodoro, undefined, true)}
                >
                  结束专注计时
                </button>
              ) : null}
              {item.executionAllCompleted === false && item.effectiveStatus === "completed" ? (
                <span className="text-sm text-amber-800">
                  已更正，子任务尚未全部完成，积分已按当前记录更新。
                </span>
              ) : null}
              {item.canStart ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void run(item, "start")}
                >
                  开始
                </button>
              ) : null}
              {item.canComplete || item.canCorrect ? (
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => openCompletion(item)}
                >
                  {item.canCorrect ? "更正完成记录" : "完成任务"}
                </button>
              ) : null}
              {item.effectiveStatus === "completed" && item.editDeadline ? (
                <span className="text-xs text-slate-500">
                  {item.canCorrect
                    ? `可更正至 ${new Date(item.editDeadline).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                    : "已超过修改期限，仅可查看"}
                </span>
              ) : null}
              {item.suppressedByScheduleItemId ? (
                <span className="text-xs">已被其他计划覆盖，仅保留记录。</span>
              ) : null}
            </>
          ) : null
        }
      />
      {completing ? (
        <Modal
          title={`${completing.effectiveStatus === "completed" ? "更正记录" : "完成任务"}：${completing.title}`}
          onClose={() => setCompleting(null)}
          layer="normal"
        >
          <p className="mb-4 text-sm text-slate-600">
            填写真实执行时间（北京时间）。填写时长后无需填写结束时间。普通完成最迟于计划日次日22:00提交。
          </p>
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              开始时间
              <input
                type="datetime-local"
                step="1"
                disabled={
                  Boolean(completing.startedAt) && completing.effectiveStatus !== "completed"
                }
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
                  step="1"
                  value={completedAt}
                  max={completionMaximum}
                  onChange={(event) => setCompletedAt(event.target.value)}
                />
              </label>
            )}
            {completing.effectiveStatus === "completed" ? (
              <TimerCorrectionFields
                enabled={includeTimer}
                onEnabled={setIncludeTimer}
                start={timerStartedAt}
                onStart={setTimerStartedAt}
                stop={timerStoppedAt}
                onStop={setTimerStoppedAt}
                paused={pausedMinutes}
                onPaused={setPausedMinutes}
                count={pauseCount}
                onCount={setPauseCount}
                timer={finalTimer}
              />
            ) : null}
            {completing.effectiveStatus === "completed" ? (
              <label className="grid gap-2 text-sm font-semibold">
                更正原因
                <TextInput
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  minLength={2}
                  maxLength={200}
                />
                <span className="text-xs font-normal text-[var(--bd-muted)]">
                  原记录会保留，相关积分会重新计算。
                </span>
              </label>
            ) : null}
          </div>
          <div className="bd-modal-footer-actions">
            <SecondaryButton onClick={() => setCompleting(null)}>取消</SecondaryButton>
            <PrimaryButton
              disabled={
                busyId === completing.id ||
                !startedAt ||
                (completing.effectiveStatus === "completed" &&
                  (correctionReason.trim().length < 2 || (includeTimer && !finalTimer))) ||
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
              {completing.effectiveStatus === "completed" ? "保存更正" : "完成任务"}
            </PrimaryButton>
          </div>
        </Modal>
      ) : null}
      {homeworkItem ? (
        <Modal
          title={`${editingTaskId ? "修改" : "添加"}子任务：${homeworkItem.title}`}
          onClose={() => setHomeworkItem(null)}
          layer="normal"
        >
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              名称
              <TextInput
                value={homeworkTitle}
                disabled={homeworkItem.taskType !== "homework"}
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
            <label className="grid gap-1 text-sm font-semibold">
              开始时间（北京时间，可选）
              <input
                type="datetime-local"
                step="1"
                value={taskStartedAt}
                onChange={(e) => setTaskStartedAt(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              结束时间（北京时间，可选）
              <input
                type="datetime-local"
                step="1"
                value={taskCompletedAt}
                onChange={(e) => setTaskCompletedAt(e.target.value)}
              />
            </label>
            {homeworkItem.effectiveStatus === "completed" ? (
              <TimerCorrectionFields
                enabled={includeTaskTimer}
                onEnabled={setIncludeTaskTimer}
                start={taskTimerStartedAt}
                onStart={setTaskTimerStartedAt}
                stop={taskTimerStoppedAt}
                onStop={setTaskTimerStoppedAt}
                paused={taskPausedMinutes}
                onPaused={setTaskPausedMinutes}
                count={taskPauseCount}
                onCount={setTaskPauseCount}
                timer={finalTaskTimer}
              />
            ) : null}
          </div>
          <div className="bd-modal-footer-actions">
            <SecondaryButton onClick={() => setHomeworkItem(null)}>取消</SecondaryButton>
            <PrimaryButton
              disabled={
                !homeworkTitle.trim() ||
                busyId === homeworkItem.id ||
                (homeworkItem.effectiveStatus === "completed" &&
                  includeTaskTimer &&
                  !finalTaskTimer)
              }
              onClick={() => void addHomeworkTask()}
            >
              保存
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
      {deletingTask ? (
        <ConfirmDialog
          title="删除子学习任务"
          message={`确定删除“${deletingTask.task.title}”？如果任务已完成，原记录会保留，积分会按本次更正重新计算。`}
          confirmLabel="删除子任务"
          tone="danger"
          busy={busyId === deletingTask.item.id}
          onConfirm={() => void deleteHomeworkTask()}
          onClose={() => {
            if (busyId !== deletingTask.item.id) setDeletingTask(null);
          }}
        />
      ) : null}
    </section>
  );
}
