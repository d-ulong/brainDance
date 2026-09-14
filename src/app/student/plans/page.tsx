"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorDialog } from "@/components/ui/error-dialog";
import { Modal } from "@/components/ui/modal";
import { PointsTodayCard } from "@/components/m2/points-today-card";
import { StudentScheduleWorkspace } from "@/components/schedule/student-schedule-workspace";
import { Field, LoadingState, PageShell, PrimaryButton, SecondaryButton, TextInput, Toast } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import { activatePlanLibrary, createGoals, fetchGoals, fetchPlanLibrary, generatePlanLibraryRange, savePlanLibrary, todayFamilyDate, updateGoal, updatePlanLibrary, type GoalDto, type PlanDefinitionDto, type PlanLibraryDto } from "@/lib/client/m2-api";

type DraftEntry = {
  title: string;
  expectedTime: string;
  repeat: "once" | "daily" | "weekly" | "monthly";
  repeatValue: string;
};

const blankEntry = (): DraftEntry => ({ title: "", expectedTime: "19:00", repeat: "daily", repeatValue: "" });

function toDefinition(title: string, description: string, startDate: string, entries: DraftEntry[]): PlanDefinitionDto {
  return {
    title,
    description: description.trim() || undefined,
    startDate,
    entries: entries.map((entry, index) => ({
      key: `item-${index + 1}`,
      title: entry.title,
      expectedTime: entry.expectedTime,
      latestStartTime: null,
      durationMinutes: null,
      repeat: entry.repeat === "once" ? { kind: "once", date: entry.repeatValue || startDate }
        : entry.repeat === "weekly" ? { kind: "weekly", weekdays: entry.repeatValue.split(",").map(Number).filter((value) => value >= 1 && value <= 7) }
          : entry.repeat === "monthly" ? { kind: "monthly", days: entry.repeatValue.split(",").map(Number).filter((value) => value >= 1 && value <= 31) }
            : { kind: "daily" },
      points: { onTimeWithin: 0, onTimeOver: 0, lateWithin: 0, lateOver: 0, incomplete: 0 },
    })),
  };
}

function fromDefinition(plan: PlanDefinitionDto): DraftEntry[] {
  return plan.entries.map((entry) => ({
    title: entry.title,
    expectedTime: entry.expectedTime,
    repeat: entry.repeat.kind as DraftEntry["repeat"],
    repeatValue: entry.repeat.kind === "once" ? entry.repeat.date ?? "" : entry.repeat.kind === "weekly" ? entry.repeat.weekdays?.join(",") ?? "" : entry.repeat.kind === "monthly" ? entry.repeat.days?.join(",") ?? "" : "",
  }));
}

export default function StudentPlansPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanLibraryDto[]>([]);
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [workspaceView, setWorkspaceView] = useState<"plans" | "schedule" | "goals">("plans");
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
  const [goalPoints, setGoalPoints] = useState("");
  const [goalGift, setGoalGift] = useState("");
  const [goalNotes, setGoalNotes] = useState("");
  const [editingGoal, setEditingGoal] = useState<GoalDto | null>(null);
  const load = useCallback(async () => {
    const [planResult, goalResult] = await Promise.all([fetchPlanLibrary(), fetchGoals()]);
    setPlans(planResult.plans);
    setGoals(goalResult.goals);
  }, []);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") return router.replace("/login");
      if (session.mustChangePassword) return router.replace("/student/change-password");
      setStudentId(session.userId);
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (requestedView === "schedule" || requestedView === "goals") setWorkspaceView(requestedView);
      try { await load(); }
      catch (cause) { setError(cause instanceof ApiError ? cause.message : "加载计划失败"); }
      finally { setLoading(false); }
    })();
  }, [load, router]);

  function switchView(next: "plans" | "schedule" | "goals") {
    setWorkspaceView(next);
    router.replace(next === "plans" ? "/student/plans" : `/student/plans?view=${next}`, { scroll: false });
  }

  async function proposeGoal(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      if (editingGoal) await updateGoal(editingGoal.assignmentId, { revision: editingGoal.revision, content: goalContent, dueDate: goalDueDate, expectedPoints: goalPoints ? Number(goalPoints) : null, expectedGift: goalGift || null, notes: goalNotes || null });
      else await createGoals({ content: goalContent, dueDate: goalDueDate, expectedPoints: goalPoints ? Number(goalPoints) : null, expectedGift: goalGift || null, notes: goalNotes || null });
      setGoalFormOpen(false); setEditingGoal(null); setGoalContent(""); setGoalPoints(""); setGoalGift(""); setGoalNotes("");
      setMessage(editingGoal ? "目标提案已更新" : "目标提案已提交，等待家长批准"); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "目标提案提交失败"); }
    finally { setSaving(false); }
  }

  function openGoalForm(goal?: GoalDto) {
    setEditingGoal(goal ?? null); setGoalContent(goal?.content ?? ""); setGoalDueDate(goal?.dueDate ?? todayFamilyDate());
    setGoalPoints(goal?.expectedPoints === null || !goal ? "" : String(goal.expectedPoints)); setGoalGift(goal?.expectedGift ?? ""); setGoalNotes(goal?.notes ?? ""); setGoalFormOpen(true);
  }

  function openCreate() {
    setEditing(null); setTitle(""); setDescription(""); setStartDate(todayFamilyDate()); setPriority("0"); setEntries([blankEntry()]); setFormOpen(true);
  }
  function openEdit(plan: PlanLibraryDto) {
    setEditing(plan); setTitle(plan.definition.title); setDescription(plan.definition.description ?? ""); setStartDate(plan.definition.startDate); setPriority(String(plan.priority)); setEntries(fromDefinition(plan.definition)); setFormOpen(true);
  }
  function changeEntry<K extends keyof DraftEntry>(index: number, key: K, value: DraftEntry[K]) {
    setEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [key]: value } : entry));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!studentId) return;
    setSaving(true); setError(null);
    try {
      const planDefinition = toDefinition(title, description, startDate, entries);
      if (editing) {
        await updatePlanLibrary(editing.id, editing.revision, planDefinition, Number(priority));
        setMessage("计划已更新，已有日程保持不变");
      } else {
        const result = await savePlanLibrary(planDefinition, Number(priority));
        const activation = await activatePlanLibrary(result.plan.id, studentId, startDate);
        setMessage(`计划已启用，并生成 ${activation.itemsCreated} 项日程`);
      }
      setFormOpen(false); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "保存计划失败"); }
    finally { setSaving(false); }
  }
  function openGenerate(plan: PlanLibraryDto) {
    const minimum = [todayFamilyDate(), plan.bindings[0]?.effectiveFrom ?? plan.definition.startDate].sort().at(-1)!;
    setRangeFrom(minimum); setRangeThrough(minimum); setGenerating(plan);
  }
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!studentId || !generating) return;
    setSaving(true); setError(null);
    try {
      const result = await generatePlanLibraryRange(generating.id, studentId, rangeFrom, rangeThrough);
      setMessage(`已生成 ${result.itemsCreated} 项日程（${result.generatedFrom} 至 ${result.generatedThrough}）`);
      setGenerating(null); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "生成日程失败"); }
    finally { setSaving(false); }
  }

  if (loading) return <PageShell title="计划日程"><LoadingState /></PageShell>;
  return <PageShell title="计划日程" backHref="/" showLogout hideHeading>
    <ErrorDialog message={error} onClose={() => setError(null)} />
    <Toast message={message} onClose={() => setMessage(null)} />
    {studentId ? <PointsTodayCard studentId={studentId} planHref="/student/plans?view=schedule" /> : null}
    <section className="bd-library-toolbar"><div className="bd-library-toolbar-copy"><h2>我的成长工作台</h2><p>计划、日程和目标都在同一个工作台内完成。</p></div></section>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--bd-border)] bg-white p-2"><strong className="px-2">我的成长工作台</strong><div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--bd-surface-soft)] p-1"><button className={`min-h-11 rounded-lg px-5 font-bold ${workspaceView === "plans" ? "bg-white text-[var(--bd-primary)] shadow" : ""}`} aria-pressed={workspaceView === "plans"} onClick={() => switchView("plans")}>计划</button><button className={`min-h-11 rounded-lg px-5 font-bold ${workspaceView === "schedule" ? "bg-white text-[var(--bd-primary)] shadow" : ""}`} aria-pressed={workspaceView === "schedule"} onClick={() => switchView("schedule")}>日程</button><button className={`min-h-11 rounded-lg px-5 font-bold ${workspaceView === "goals" ? "bg-white text-[var(--bd-primary)] shadow" : ""}`} aria-pressed={workspaceView === "goals"} onClick={() => switchView("goals")}>目标</button></div></div>
    {workspaceView === "schedule" && studentId ? <StudentScheduleWorkspace studentId={studentId} /> : null}
    {workspaceView === "goals" ? <section id="recent-goals" className="bd-panel"><div className="bd-section-heading"><h2>我的目标</h2><PrimaryButton fullWidth={false} onClick={() => openGoalForm()}>提交期望目标</PrimaryButton></div><div className="grid gap-2 sm:grid-cols-3">{goals.map((goal) => <article key={goal.assignmentId} className="rounded-2xl bg-[var(--bd-surface-soft)] p-3"><div className="flex justify-between gap-2"><strong>{goal.content}</strong><span className="text-xs text-[var(--bd-primary)]">{goal.status === "pending_approval" ? "待审批" : goal.status === "active" ? "进行中" : goal.status === "succeeded" ? "已达成" : "未达成"}</span></div><p className="mt-2 text-xs text-slate-500">截止 {goal.dueDate}{goal.expectedPoints ? ` · 期望 ${goal.expectedPoints} 分` : ""}</p>{goal.canEdit ? <button type="button" className="mt-2 text-sm font-semibold text-[var(--bd-primary)]" onClick={() => openGoalForm(goal)}>编辑提案</button> : null}</article>)}{!goals.length ? <p className="text-sm text-slate-500">还没有目标，可以向家长提交一个期望。</p> : null}</div></section> : null}
    {workspaceView === "plans" && <><section className="flex justify-end"><PrimaryButton type="button" fullWidth={false} onClick={openCreate} data-testid="student-plan-create">制定计划</PrimaryButton></section>{plans.length ? <div className="bd-library-grid">{plans.map((plan) => <article className="bd-library-card" key={plan.id}>
      <div className="bd-library-card-head"><h3 className="bd-library-card-title">{plan.definition.title}</h3><span className="bd-library-count">{plan.definition.entries.length} 项</span></div>
      <p className="bd-library-summary">{plan.definition.description || plan.definition.entries.map((entry) => entry.title).join("、")}</p>
      <p className="text-sm text-neutral-600">{plan.canEdit ? "我制定的计划" : `${plan.ownerName ?? "家长"}为我制定`} · 优先级 {plan.priority}</p>
      <p className="text-sm font-semibold text-[var(--bd-primary)]">{plan.boundToSelf ? `已启用 · ${plan.bindings[0]?.effectiveFrom}` : "尚未启用"}</p>
      <div className="bd-library-actions">{plan.canEdit ? <SecondaryButton onClick={() => openEdit(plan)}>编辑</SecondaryButton> : null}{plan.boundToSelf ? <PrimaryButton type="button" fullWidth={false} onClick={() => openGenerate(plan)}>生成日程</PrimaryButton> : plan.canEdit && studentId ? <PrimaryButton type="button" fullWidth={false} onClick={() => void activatePlanLibrary(plan.id, studentId).then(load).catch((cause) => setError(cause instanceof ApiError ? cause.message : "启用失败"))}>启用计划</PrimaryButton> : null}</div>
    </article>)}</div> : <p className="bd-empty">还没有计划，点击“制定计划”开始。</p>}</>}
    {formOpen ? <Modal title={editing ? "编辑我的计划" : "制定新计划"} onClose={() => setFormOpen(false)}><form className="space-y-4" onSubmit={save}>
      <Field label="计划名称"><TextInput required value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <Field label="计划说明（可选）"><textarea maxLength={4000} className="min-h-24 w-full rounded-2xl border border-neutral-300 bg-white p-3" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="写下计划想达成什么" /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="开始日期"><TextInput required type="date" min={editing ? undefined : todayFamilyDate()} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field><Field label="优先级"><TextInput required type="number" min="0" max="100" value={priority} onChange={(event) => setPriority(event.target.value)} /></Field></div>
      {entries.map((entry, index) => <fieldset className="space-y-3 rounded-2xl border border-[var(--bd-border)] p-3" key={index}><legend className="font-bold">内容 {index + 1}</legend>
        <Field label="内容名称"><TextInput required value={entry.title} onChange={(event) => changeEntry(index, "title", event.target.value)} /></Field>
        <Field label="执行时间"><TextInput required type="time" value={entry.expectedTime} onChange={(event) => changeEntry(index, "expectedTime", event.target.value)} /></Field>
        <p className="text-xs text-neutral-500">自主计划记录完成情况，但不会由学生自行设置或获得积分。</p>
        <Field label="重复方式"><select className="min-h-11 rounded-2xl border p-2" value={entry.repeat} onChange={(event) => changeEntry(index, "repeat", event.target.value as DraftEntry["repeat"])}><option value="once">某天</option><option value="daily">每天</option><option value="weekly">每周星期几</option><option value="monthly">每月几号</option></select></Field>
        {entry.repeat !== "daily" ? <Field label={entry.repeat === "once" ? "日期" : "多个值用逗号分隔"}><TextInput required value={entry.repeatValue} onChange={(event) => changeEntry(index, "repeatValue", event.target.value)} /></Field> : null}
        {entries.length > 1 ? <SecondaryButton onClick={() => setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index))}>删除内容</SecondaryButton> : null}
      </fieldset>)}
      <SecondaryButton onClick={() => setEntries((current) => [...current, blankEntry()])}>添加内容</SecondaryButton>
      <PrimaryButton type="submit" disabled={saving} data-testid="student-plan-save">{saving ? "保存中…" : editing ? "保存修改" : "保存并启用"}</PrimaryButton>
    </form></Modal> : null}
    {generating ? <Modal title={`生成“${generating.definition.title}”日程`} onClose={() => setGenerating(null)}><form className="space-y-4" onSubmit={generate}><p className="rounded-2xl bg-[var(--bd-surface-soft)] p-3 text-sm text-slate-700">生成对象：我。只会生成我的日程。</p><div className="grid grid-cols-2 gap-3"><Field label="开始日期"><TextInput required type="date" min={rangeFrom} value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} /></Field><Field label="结束日期"><TextInput required type="date" min={rangeFrom} value={rangeThrough} onChange={(event) => setRangeThrough(event.target.value)} /></Field></div><PrimaryButton type="submit" disabled={saving}>{saving ? "生成中…" : "生成日程"}</PrimaryButton></form></Modal> : null}
    {goalFormOpen ? <Modal title={editingGoal ? "编辑目标提案" : "提交期望目标"} onClose={() => { setGoalFormOpen(false); setEditingGoal(null); }}><form className="space-y-3" onSubmit={proposeGoal}><p className="text-sm text-slate-600">审批前可以修改；审批后由责任家长维护和评定。</p><Field label="目标内容"><textarea required maxLength={500} className="min-h-28 w-full rounded-2xl border p-3" value={goalContent} onChange={(event) => setGoalContent(event.target.value)} /></Field><Field label="期望完成日期"><TextInput required type="date" min={todayFamilyDate()} value={goalDueDate} onChange={(event) => setGoalDueDate(event.target.value)} /></Field><Field label="期望积分（可选）"><TextInput type="number" min={0} value={goalPoints} onChange={(event) => setGoalPoints(event.target.value)} /></Field><Field label="期望礼物（可选）"><TextInput value={goalGift} onChange={(event) => setGoalGift(event.target.value)} /></Field><Field label="备注（可选）"><textarea className="min-h-20 w-full rounded-2xl border p-3" value={goalNotes} onChange={(event) => setGoalNotes(event.target.value)} /></Field><PrimaryButton type="submit" disabled={saving}>{saving ? "保存中…" : editingGoal ? "保存提案修改" : "提交给家长审批"}</PrimaryButton></form></Modal> : null}
  </PageShell>;
}
