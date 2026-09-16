"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { CompactGeneratedDates } from "@/components/schedule/compact-generated-dates";
import { StudentScheduleWorkspace } from "@/components/schedule/student-schedule-workspace";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Modal } from "@/components/ui/modal";
import {
  Field,
  LoadingState,
  PageShell,
  PrimaryButton,
  SecondaryButton,
  TextInput,
  Toast,
} from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";

import {
  activatePlanLibrary,
  createGoals,
  fetchGoals,
  fetchPlanLibrary,
  fetchPointsBalance,
  fetchScheduleItems,
  generatePlanLibraryRange,
  savePlanLibrary,
  scheduleStatusLabel,
  todayFamilyDate,
  updateGoal,
  updatePlanLibrary,
  type GoalDto,
  type PlanDefinitionDto,
  type PlanLibraryDto,
  type ScheduleItemDto,
} from "@/lib/client/m2-api";

type DraftEntry = {
  title: string;
  description: string;
  expectedTime: string;
  repeat: "once" | "daily" | "weekly" | "monthly";
  repeatValue: string;
};

type SectionKey = "summary" | "schedule" | "plans" | "goals";

const horizonLabel = { short: "近期", medium: "中期", long: "远期" } as const;

const blankEntry = (): DraftEntry => ({
  title: "",
  description: "",
  expectedTime: "19:00",
  repeat: "daily",
  repeatValue: "",
});

function toDefinition(
  title: string,
  description: string,
  startDate: string,
  entries: DraftEntry[],
): PlanDefinitionDto {
  return {
    title,
    description: description.trim() || undefined,
    startDate,
    entries: entries.map((entry, index) => ({
      key: `item-${index + 1}`,
      title: entry.title,
      description: entry.description.trim() || undefined,
      expectedTime: entry.expectedTime,
      latestStartTime: null,
      durationMinutes: null,
      repeat:
        entry.repeat === "once"
          ? { kind: "once", date: entry.repeatValue || startDate }
          : entry.repeat === "weekly"
            ? {
                kind: "weekly",
                weekdays: entry.repeatValue
                  .split(",")
                  .map(Number)
                  .filter((value) => value >= 1 && value <= 7),
              }
            : entry.repeat === "monthly"
              ? {
                  kind: "monthly",
                  days: entry.repeatValue
                    .split(",")
                    .map(Number)
                    .filter((value) => value >= 1 && value <= 31),
                }
              : { kind: "daily" },
      points: { onTimeWithin: 0, onTimeOver: 0, lateWithin: 0, lateOver: 0, incomplete: 0 },
    })),
  };
}

function fromDefinition(plan: PlanDefinitionDto): DraftEntry[] {
  return plan.entries.map((entry) => ({
    title: entry.title,
    description: entry.description ?? "",
    expectedTime: entry.expectedTime,
    repeat: entry.repeat.kind as DraftEntry["repeat"],
    repeatValue:
      entry.repeat.kind === "once"
        ? (entry.repeat.date ?? "")
        : entry.repeat.kind === "weekly"
          ? (entry.repeat.weekdays?.join(",") ?? "")
          : entry.repeat.kind === "monthly"
            ? (entry.repeat.days?.join(",") ?? "")
            : "",
  }));
}

export default function StudentPlansPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanLibraryDto[]>([]);
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [todayItems, setTodayItems] = useState<ScheduleItemDto[]>([]);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    summary: true,
    schedule: true,
    plans: true,
    goals: true,
  });
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PlanLibraryDto | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(todayFamilyDate());
  const [priority, setPriority] = useState("0");
  const [entries, setEntries] = useState<DraftEntry[]>([blankEntry()]);
  const [generating, setGenerating] = useState<PlanLibraryDto | null>(null);
  const [rangeFrom, setRangeFrom] = useState(todayFamilyDate());
  const [rangeThrough, setRangeThrough] = useState(todayFamilyDate());
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [goalContent, setGoalContent] = useState("");
  const [goalDueDate, setGoalDueDate] = useState(todayFamilyDate());
  const [goalHorizon, setGoalHorizon] = useState<"short" | "medium" | "long">("medium");
  const [goalPoints, setGoalPoints] = useState("");
  const [goalGift, setGoalGift] = useState("");
  const [goalNotes, setGoalNotes] = useState("");
  const [editingGoal, setEditingGoal] = useState<GoalDto | null>(null);

  const load = useCallback(async (id: string) => {
    const today = todayFamilyDate();
    const [planResult, goalResult, balanceResult, scheduleResult] = await Promise.allSettled([
      fetchPlanLibrary(),
      fetchGoals(),
      fetchPointsBalance(id),
      fetchScheduleItems(id, today, today),
    ]);
    const failures: string[] = [];
    if (planResult.status === "fulfilled") setPlans(planResult.value.plans);
    else {
      setPlans([]);
      failures.push(
        planResult.reason instanceof ApiError ? planResult.reason.message : "计划库加载失败",
      );
    }
    if (goalResult.status === "fulfilled") setGoals(goalResult.value.goals);
    else {
      setGoals([]);
      failures.push(
        goalResult.reason instanceof ApiError ? goalResult.reason.message : "目标加载失败",
      );
    }
    if (balanceResult.status === "fulfilled") setBalance(balanceResult.value.balance);
    else {
      setBalance(null);
      failures.push(
        balanceResult.reason instanceof ApiError ? balanceResult.reason.message : "积分余额加载失败",
      );
    }
    if (scheduleResult.status === "fulfilled") {
      setTodayItems(scheduleResult.value.items.filter((item) => item.familyDate === today));
    } else {
      setTodayItems([]);
      failures.push(
        scheduleResult.reason instanceof ApiError
          ? scheduleResult.reason.message
          : "今日任务加载失败",
      );
    }
    if (failures.length) setError(failures.join("；"));
  }, []);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") return router.replace("/login");
      if (session.mustChangePassword) return router.replace("/student/change-password");
      setStudentId(session.userId);
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (requestedView === "schedule" || requestedView === "goals" || requestedView === "plans") {
        setOpenSections({
          summary: true,
          schedule: requestedView === "schedule",
          plans: requestedView === "plans",
          goals: requestedView === "goals",
        });
        requestAnimationFrame(() => {
          document
            .getElementById(`workbench-${requestedView}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      try {
        await load(session.userId);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "加载成长工作台失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [load, router]);

  const completedCount = useMemo(
    () => todayItems.filter((item) => item.effectiveStatus === "completed").length,
    [todayItems],
  );

  function toggleSection(key: SectionKey) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }

  async function proposeGoal(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        content: goalContent,
        dueDate: goalDueDate,
        expectedPoints: goalPoints ? Number(goalPoints) : null,
        expectedGift: goalGift || null,
        notes: goalNotes || null,
        horizon: goalHorizon,
      };
      if (editingGoal) {
        await updateGoal(editingGoal.assignmentId, { revision: editingGoal.revision, ...body });
      } else {
        await createGoals(body);
      }
      setGoalFormOpen(false);
      setEditingGoal(null);
      setGoalContent("");
      setGoalPoints("");
      setGoalGift("");
      setGoalNotes("");
      setGoalHorizon("medium");
      setMessage(editingGoal ? "目标提案已更新" : "目标提案已提交，等待家长批准");
      if (studentId) await load(studentId);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "目标提案提交失败");
    } finally {
      setSaving(false);
    }
  }

  function openGoalForm(goal?: GoalDto) {
    setEditingGoal(goal ?? null);
    setGoalContent(goal?.content ?? "");
    setGoalDueDate(goal?.dueDate ?? todayFamilyDate());
    setGoalHorizon(goal?.horizon ?? "medium");
    setGoalPoints(goal?.expectedPoints === null || !goal ? "" : String(goal.expectedPoints));
    setGoalGift(goal?.expectedGift ?? "");
    setGoalNotes(goal?.notes ?? "");
    setGoalFormOpen(true);
  }

  function openCreate() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setStartDate(todayFamilyDate());
    setPriority("0");
    setEntries([blankEntry()]);
    setFormOpen(true);
  }

  function openEdit(plan: PlanLibraryDto) {
    setEditing(plan);
    setTitle(plan.definition.title);
    setDescription(plan.definition.description ?? "");
    setStartDate(plan.definition.startDate);
    setPriority(String(plan.priority));
    setEntries(fromDefinition(plan.definition));
    setFormOpen(true);
  }

  function changeEntry<K extends keyof DraftEntry>(index: number, key: K, value: DraftEntry[K]) {
    setEntries((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, [key]: value } : entry)),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!studentId) return;
    setSaving(true);
    setError(null);
    try {
      const planDefinition = toDefinition(title, description, startDate, entries);
      if (editing) {
        await updatePlanLibrary(editing.id, editing.revision, planDefinition, Number(priority));
        setMessage("计划已更新，已有日程保持不变");
      } else {
        const result = await savePlanLibrary(planDefinition, Number(priority));
        const activation = await activatePlanLibrary(result.plan.id, studentId, startDate);
        if (activation.itemsCreated > 0) {
          setMessage(
            `计划已启用，并生成 ${activation.itemsCreated} 项日程（实际日期 ${activation.generatedFrom} 至 ${activation.generatedThrough}）`,
          );
        } else if (activation.matchedOccurrences === 0) {
          setMessage(
            `计划已启用，未新增日程：该重复规则在 ${activation.generatedFrom} 至 ${activation.generatedThrough} 范围内没有匹配日期`,
          );
        } else {
          setMessage(
            `计划已启用，未新增日程：幂等回放（实际日期 ${activation.generatedFrom} 至 ${activation.generatedThrough}）`,
          );
        }
      }
      setFormOpen(false);
      await load(studentId);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存计划失败");
    } finally {
      setSaving(false);
    }
  }

  function openGenerate(plan: PlanLibraryDto) {
    const minimum = [
      todayFamilyDate(),
      plan.bindings[0]?.effectiveFrom ?? plan.definition.startDate,
    ]
      .sort()
      .at(-1)!;
    setRangeFrom(minimum);
    setRangeThrough(minimum);
    setGenerating(plan);
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!studentId || !generating) return;
    setSaving(true);
    setError(null);
    try {
      const result = await generatePlanLibraryRange(
        generating.id,
        studentId,
        rangeFrom,
        rangeThrough,
      );
      setMessage(
        result.itemsCreated > 0
          ? `已生成 ${result.itemsCreated} 项日程（${result.generatedFrom} 至 ${result.generatedThrough}）`
          : result.idempotentReplay
            ? `未新增日程：幂等回放（${result.generatedFrom} 至 ${result.generatedThrough}）`
            : `未新增日程：该重复规则在 ${result.generatedFrom} 至 ${result.generatedThrough} 范围内没有匹配日期`,
      );
      setGenerating(null);
      await load(studentId);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "生成日程失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="计划日程">
        <LoadingState />
      </PageShell>
    );
  }

  return (
    <PageShell title="计划日程" backHref="/" showLogout hideHeading>
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={message} onClose={() => setMessage(null)} />

      <section className="bd-library-toolbar" data-testid="student-growth-workbench">
        <div className="bd-library-toolbar-copy">
          <h2>我的成长工作台</h2>
          <p>积分与任务、日程、计划和目标都在同一页，可按需展开或收起。</p>
        </div>
      </section>

      <div className="space-y-4">
        <section className="bd-panel" id="workbench-summary" data-testid="workbench-summary">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
            aria-expanded={openSections.summary}
            onClick={() => toggleSection("summary")}
          >
            <h2 className="text-lg font-bold">积分余额与今日任务</h2>
            <span className="text-sm font-semibold text-[var(--bd-primary)]">
              {openSections.summary ? "收起" : "展开"}
            </span>
          </button>
          {openSections.summary ? (
            <div className="mt-4">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-[var(--bd-surface-soft)] p-3">
                  <dt className="text-sm text-slate-600">积分余额</dt>
                  <dd className="text-xl font-bold" data-testid="points-balance">
                    {balance ?? "—"}
                  </dd>
                </div>
                <div className="rounded-2xl bg-[var(--bd-surface-soft)] p-3">
                  <dt className="text-sm text-slate-600">今日任务</dt>
                  <dd className="text-xl font-bold">{todayItems.length}</dd>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-3">
                  <dt className="text-sm text-emerald-800">已完成</dt>
                  <dd className="text-xl font-bold text-emerald-700">{completedCount}</dd>
                </div>
              </dl>
              <ul className="mt-4 space-y-2">
                {todayItems.map((item) => {
                  const completed = item.effectiveStatus === "completed";
                  const open = detailItemId === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-testid={`today-task-${item.id}`}
                        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-3 text-left ${
                          completed
                            ? "border border-emerald-300 bg-emerald-50 text-emerald-900"
                            : "border border-[var(--bd-border)] bg-[var(--bd-surface-soft)]"
                        }`}
                        aria-expanded={open}
                        onClick={() =>
                          setDetailItemId((current) => (current === item.id ? null : item.id))
                        }
                        onMouseEnter={() => setDetailItemId(item.id)}
                      >
                        <span className="font-semibold">{item.title}</span>
                        <span
                          data-testid={`today-task-status-${item.id}`}
                          className={`text-sm font-bold ${completed ? "text-emerald-700" : "text-slate-600"}`}
                        >
                          {scheduleStatusLabel(item.effectiveStatus)}
                        </span>
                      </button>
                      {open ? (
                        <div className="mt-1 rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600">
                          <p>计划：{item.planTitle}</p>
                          {item.description ? (
                            <p className="mt-1 whitespace-pre-wrap">说明：{item.description}</p>
                          ) : null}
                          <p className="mt-1">
                            时间：
                            {item.scheduledAt
                              ? new Date(item.scheduledAt).toLocaleTimeString("zh-CN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: false,
                                  timeZone: "Asia/Shanghai",
                                })
                              : "时间待定"}
                          </p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {!todayItems.length ? (
                  <li className="text-sm text-slate-500">今日暂无日程</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="bd-panel" id="workbench-schedule">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
            aria-expanded={openSections.schedule}
            onClick={() => toggleSection("schedule")}
          >
            <h2 className="text-lg font-bold">日程日历</h2>
            <span className="text-sm font-semibold text-[var(--bd-primary)]">
              {openSections.schedule ? "收起" : "展开"}
            </span>
          </button>
          {openSections.schedule && studentId ? (
            <div className="mt-4">
              <StudentScheduleWorkspace studentId={studentId} />
            </div>
          ) : null}
        </section>

        <section className="bd-panel" id="workbench-plans">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
            aria-expanded={openSections.plans}
            onClick={() => toggleSection("plans")}
          >
            <h2 className="text-lg font-bold">计划</h2>
            <span className="text-sm font-semibold text-[var(--bd-primary)]">
              {openSections.plans ? "收起" : "展开"}
            </span>
          </button>
          {openSections.plans ? (
            <div className="mt-4">
              <div className="mb-3 flex justify-end">
                <PrimaryButton
                  type="button"
                  fullWidth={false}
                  onClick={openCreate}
                  data-testid="student-plan-create"
                >
                  制定计划
                </PrimaryButton>
              </div>
              {plans.length ? (
                <div className="bd-library-grid">
                  {plans.map((plan) => (
                    <article className="bd-library-card" key={plan.id}>
                      <div className="bd-library-card-head">
                        <h3 className="bd-library-card-title">{plan.definition.title}</h3>
                        <span className="bd-library-count">{plan.definition.entries.length} 项</span>
                      </div>
                      <p className="bd-library-summary">
                        {plan.definition.description ||
                          plan.definition.entries.map((entry) => entry.title).join("、")}
                      </p>
                      <p className="text-sm text-neutral-600">
                        {plan.canEdit ? "我制定的计划" : `${plan.ownerName ?? "家长"}为我制定`} ·
                        优先级 {plan.priority}
                      </p>
                      <p className="mt-1 text-sm">
                        已生成日期：
                        <CompactGeneratedDates
                          dates={studentId ? plan.generatedDatesByStudent?.[studentId] ?? [] : []}
                        />
                      </p>
                      <p className="text-sm font-semibold text-[var(--bd-primary)]">
                        {plan.boundToSelf
                          ? `已启用 · ${plan.bindings[0]?.effectiveFrom}`
                          : "尚未启用"}
                      </p>
                      <div className="bd-library-actions">
                        {plan.canEdit ? (
                          <SecondaryButton onClick={() => openEdit(plan)}>编辑</SecondaryButton>
                        ) : null}
                        {plan.boundToSelf ? (
                          <PrimaryButton
                            type="button"
                            fullWidth={false}
                            onClick={() => openGenerate(plan)}
                          >
                            生成日程
                          </PrimaryButton>
                        ) : plan.canEdit && studentId ? (
                          <PrimaryButton
                            type="button"
                            fullWidth={false}
                            onClick={() =>
                              void activatePlanLibrary(plan.id, studentId)
                                .then(() => load(studentId))
                                .catch((cause) =>
                                  setError(
                                    cause instanceof ApiError ? cause.message : "启用失败",
                                  ),
                                )
                            }
                          >
                            启用计划
                          </PrimaryButton>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="bd-empty">还没有计划，点击“制定计划”开始。</p>
              )}
            </div>
          ) : null}
        </section>

        <section className="bd-panel" id="workbench-goals">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
            aria-expanded={openSections.goals}
            onClick={() => toggleSection("goals")}
          >
            <h2 className="text-lg font-bold">目标</h2>
            <span className="text-sm font-semibold text-[var(--bd-primary)]">
              {openSections.goals ? "收起" : "展开"}
            </span>
          </button>
          {openSections.goals ? (
            <div className="mt-4">
              <div className="mb-3 flex justify-end">
                <PrimaryButton fullWidth={false} onClick={() => openGoalForm()}>
                  提交期望目标
                </PrimaryButton>
              </div>
              {(["short", "medium", "long"] as const).map((horizon) => {
                const group = goals.filter((goal) => goal.horizon === horizon);
                if (!group.length) return null;
                return (
                  <div key={horizon} className="mt-4">
                    <h3 className="mb-2 text-sm font-bold text-slate-600">
                      {horizonLabel[horizon]}
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {group.map((goal) => (
                        <article
                          key={goal.assignmentId}
                          className="rounded-2xl bg-[var(--bd-surface-soft)] p-3"
                        >
                          <div className="flex justify-between gap-2">
                            <strong>{goal.content}</strong>
                            <span className="text-xs text-[var(--bd-primary)]">
                              {goal.status === "pending_approval"
                                ? "待审批"
                                : goal.status === "active"
                                  ? "进行中"
                                  : goal.status === "succeeded"
                                    ? "已达成"
                                    : "未达成"}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            截止 {goal.dueDate}
                            {goal.expectedPoints ? ` · 期望 ${goal.expectedPoints} 分` : ""}
                          </p>
                          {goal.giftRedeemedAt ? (
                            <p className="mt-1 text-xs text-emerald-700">
                              礼物已兑现：{new Date(goal.giftRedeemedAt).toLocaleString("zh-CN")}
                            </p>
                          ) : goal.actualGift ? (
                            <p className="mt-1 text-xs text-amber-700">礼物尚未兑现</p>
                          ) : null}
                          {goal.canEdit ? (
                            <button
                              type="button"
                              className="mt-2 text-sm font-semibold text-[var(--bd-primary)]"
                              onClick={() => openGoalForm(goal)}
                            >
                              编辑提案
                            </button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!goals.length ? (
                <p className="text-sm text-slate-500">还没有目标，可以向家长提交一个期望。</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {formOpen ? (
        <Modal title={editing ? "编辑我的计划" : "制定新计划"} onClose={() => setFormOpen(false)}>
          <form className="space-y-4" onSubmit={save}>
            <Field label="计划名称">
              <TextInput required value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="计划说明（可选）">
              <textarea
                maxLength={4000}
                className="min-h-24 w-full rounded-2xl border border-neutral-300 bg-white p-3"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="写下计划想达成什么"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始日期">
                <TextInput
                  required
                  type="date"
                  min={editing ? undefined : todayFamilyDate()}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
              <Field label="优先级">
                <TextInput
                  required
                  type="number"
                  min="0"
                  max="100"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                />
              </Field>
            </div>
            {entries.map((entry, index) => (
              <fieldset
                className="space-y-3 rounded-2xl border border-[var(--bd-border)] p-3"
                key={index}
              >
                <legend className="font-bold">内容 {index + 1}</legend>
                <Field label="内容名称">
                  <TextInput
                    required
                    value={entry.title}
                    onChange={(event) => changeEntry(index, "title", event.target.value)}
                  />
                </Field>
                <Field label="内容说明（可选）">
                  <textarea
                    maxLength={500}
                    className="min-h-20 w-full rounded-2xl border p-3"
                    value={entry.description}
                    onChange={(event) => changeEntry(index, "description", event.target.value)}
                  />
                </Field>
                <Field label="执行时间">
                  <TextInput
                    required
                    type="time"
                    value={entry.expectedTime}
                    onChange={(event) => changeEntry(index, "expectedTime", event.target.value)}
                  />
                </Field>
                <p className="text-xs text-neutral-500">
                  自主计划记录完成情况，但不会由学生自行设置或获得积分。
                </p>
                <Field label="重复方式">
                  <select
                    className="min-h-11 rounded-2xl border p-2"
                    value={entry.repeat}
                    onChange={(event) =>
                      changeEntry(index, "repeat", event.target.value as DraftEntry["repeat"])
                    }
                  >
                    <option value="once">某天</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周星期几</option>
                    <option value="monthly">每月几号</option>
                  </select>
                </Field>
                {entry.repeat !== "daily" ? (
                  <Field label={entry.repeat === "once" ? "日期" : "多个值用逗号分隔"}>
                    <TextInput
                      required
                      value={entry.repeatValue}
                      onChange={(event) => changeEntry(index, "repeatValue", event.target.value)}
                    />
                  </Field>
                ) : null}
                {entries.length > 1 ? (
                  <SecondaryButton
                    onClick={() =>
                      setEntries((current) =>
                        current.filter((_, entryIndex) => entryIndex !== index),
                      )
                    }
                  >
                    删除内容
                  </SecondaryButton>
                ) : null}
              </fieldset>
            ))}
            <SecondaryButton onClick={() => setEntries((current) => [...current, blankEntry()])}>
              添加内容
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving} data-testid="student-plan-save">
              {saving ? "保存中…" : editing ? "保存修改" : "保存并启用"}
            </PrimaryButton>
          </form>
        </Modal>
      ) : null}

      {generating ? (
        <Modal
          title={`生成“${generating.definition.title}”日程`}
          onClose={() => setGenerating(null)}
        >
          <form className="space-y-4" onSubmit={generate}>
            <p className="rounded-2xl bg-[var(--bd-surface-soft)] p-3 text-sm text-slate-700">
              生成对象：我。只会生成我的日程。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始日期">
                <TextInput
                  required
                  type="date"
                  min={rangeFrom}
                  value={rangeFrom}
                  onChange={(event) => setRangeFrom(event.target.value)}
                />
              </Field>
              <Field label="结束日期">
                <TextInput
                  required
                  type="date"
                  min={rangeFrom}
                  value={rangeThrough}
                  onChange={(event) => setRangeThrough(event.target.value)}
                />
              </Field>
            </div>
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? "生成中…" : "生成日程"}
            </PrimaryButton>
          </form>
        </Modal>
      ) : null}

      {goalFormOpen ? (
        <Modal
          title={editingGoal ? "编辑目标提案" : "提交期望目标"}
          onClose={() => {
            setGoalFormOpen(false);
            setEditingGoal(null);
          }}
        >
          <form className="space-y-3" onSubmit={proposeGoal}>
            <p className="text-sm text-slate-600">审批前可以修改；审批后由责任家长维护和评定。</p>
            <Field label="目标内容">
              <textarea
                required
                maxLength={500}
                className="min-h-28 w-full rounded-2xl border p-3"
                value={goalContent}
                onChange={(event) => setGoalContent(event.target.value)}
              />
            </Field>
            <Field label="期限">
              <select
                className="min-h-11 w-full rounded-2xl border p-2"
                value={goalHorizon}
                onChange={(event) =>
                  setGoalHorizon(event.target.value as "short" | "medium" | "long")
                }
              >
                <option value="short">近期</option>
                <option value="medium">中期</option>
                <option value="long">远期</option>
              </select>
            </Field>
            <Field label="期望完成日期">
              <TextInput
                required
                type="date"
                min={todayFamilyDate()}
                value={goalDueDate}
                onChange={(event) => setGoalDueDate(event.target.value)}
              />
            </Field>
            <Field label="期望积分（可选）">
              <TextInput
                type="number"
                min={0}
                value={goalPoints}
                onChange={(event) => setGoalPoints(event.target.value)}
              />
            </Field>
            <Field label="期望礼物（可选）">
              <TextInput value={goalGift} onChange={(event) => setGoalGift(event.target.value)} />
            </Field>
            <Field label="备注（可选）">
              <textarea
                className="min-h-20 w-full rounded-2xl border p-3"
                value={goalNotes}
                onChange={(event) => setGoalNotes(event.target.value)}
              />
            </Field>
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? "保存中…" : editingGoal ? "保存提案修改" : "提交给家长审批"}
            </PrimaryButton>
          </form>
        </Modal>
      ) : null}
    </PageShell>
  );
}
