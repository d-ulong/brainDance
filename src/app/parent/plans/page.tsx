"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { StudentMultiSelect } from "@/components/ui/student-multi-select";
import { StudentManagementTabs } from "@/components/ui/student-management-tabs";
import { CompactGeneratedDates } from "@/components/schedule/compact-generated-dates";
import { StudentContextBanner } from "@/components/ui/student-context-banner";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  activatePlanLibrary,
  fetchLinkedStudents,
  fetchPlanLibrary,
  generatePlanLibraryRange,
  removePlanLibraryBinding,
  savePlanLibrary,
  updatePlanLibrary,
  type LinkedStudentDto,
  type PlanDefinitionDto,
  type PlanLibraryDto,
} from "@/lib/client/m2-api";

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
type Draft = {
  title: string;
  description: string;
  time: string;
  latest: string;
  duration: string;
  repeat: "once" | "daily" | "weekly" | "monthly";
  value: string;
  points: string[];
};
type Action = { plan: PlanLibraryDto; kind: "bind" | "generate" } | null;
function maxDate(...dates: string[]) {
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}
function earliestGenerateDate(plan: PlanLibraryDto, studentIds: string[]) {
  const selectedBindings = plan.bindings.filter((binding) => studentIds.includes(binding.studentId));
  return maxDate(
    today(),
    ...(selectedBindings.length ? selectedBindings : plan.bindings).map(
      (binding) => binding.effectiveFrom,
    ),
  );
}
const blank = (): Draft => ({
  title: "",
  description: "",
  time: "19:00",
  latest: "",
  duration: "",
  repeat: "daily",
  value: "",
  points: ["10", "0", "0", "0", "0"],
});

function definition(title: string, description: string, startDate: string, items: Draft[]): PlanDefinitionDto {
  return {
    title,
    description: description.trim() || undefined,
    startDate,
    entries: items.map((item, index) => ({
      key: `item-${index + 1}`,
      title: item.title,
      description: item.description.trim() || undefined,
      expectedTime: item.time,
      latestStartTime: item.latest || null,
      durationMinutes: item.duration ? Number(item.duration) : null,
      repeat:
        item.repeat === "once"
          ? { kind: "once", date: item.value || startDate }
          : item.repeat === "weekly"
            ? {
                kind: "weekly",
                weekdays: item.value
                  .split(",")
                  .map(Number)
                  .filter((value) => value >= 1 && value <= 7),
              }
            : item.repeat === "monthly"
              ? {
                  kind: "monthly",
                  days: item.value
                    .split(",")
                    .map(Number)
                    .filter((value) => value >= 1 && value <= 31),
                }
              : { kind: "daily" },
      points: {
        onTimeWithin: Number(item.points[0]),
        onTimeOver: Number(item.points[1]),
        lateWithin: Number(item.points[2]),
        lateOver: Number(item.points[3]),
        incomplete: Number(item.points[4]),
      },
    })),
  };
}

function drafts(plan: PlanDefinitionDto): Draft[] {
  return plan.entries.map((entry) => ({
    title: entry.title,
    description: entry.description ?? "",
    time: entry.expectedTime,
    latest: entry.latestStartTime ?? "",
    duration: entry.durationMinutes ? String(entry.durationMinutes) : "",
    repeat: entry.repeat.kind as Draft["repeat"],
    value:
      entry.repeat.kind === "once"
        ? (entry.repeat.date ?? "")
        : entry.repeat.kind === "weekly"
          ? (entry.repeat.weekdays ?? []).join(",")
          : entry.repeat.kind === "monthly"
            ? (entry.repeat.days ?? []).join(",")
            : "",
    points: [
      entry.points.onTimeWithin,
      entry.points.onTimeOver,
      entry.points.lateWithin,
      entry.points.lateOver,
      entry.points.incomplete,
    ].map(String),
  }));
}

export default function ParentPlansPage() {
  const router = useRouter();
  const params = useParams<{ studentId?: string }>();
  const contextStudentId = params.studentId;
  const [plans, setPlans] = useState<PlanLibraryDto[]>([]);
  const [students, setStudents] = useState<LinkedStudentDto[]>([]);
  const [selfOption, setSelfOption] = useState<LinkedStudentDto | null>(null);
  const [selfOnly, setSelfOnly] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());
  const [priority, setPriority] = useState("0");
  const [items, setItems] = useState<Draft[]>([blank()]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [actionStudents, setActionStudents] = useState<string[]>([]);
  const [rangeFrom, setRangeFrom] = useState(today());
  const [rangeThrough, setRangeThrough] = useState(today());
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removalTarget, setRemovalTarget] = useState<{ plan: PlanLibraryDto; studentId: string; studentName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [planQuery, setPlanQuery] = useState("");
  const [planStudentFilter, setPlanStudentFilter] = useState("");
  const [bindingFilter, setBindingFilter] = useState<"all" | "bound" | "unbound">("all");
  const load = useCallback(async () => {
    const [planResponse, studentResponse] = await Promise.all([
      fetchPlanLibrary(),
      fetchLinkedStudents(),
    ]);
    setPlans(planResponse.plans);
    setStudents(studentResponse.students);
  }, []);
  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") return router.replace("/login");
      setSelfOption({ studentId: session.userId, displayName: `${session.displayName || session.account || "我"}（我的个人计划）`, username: session.account ?? null });
      setSelfOnly(new URLSearchParams(window.location.search).get("scope") === "self");
      try {
        await load();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "加载计划失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [load, router]);
  const assignmentOptions = selfOption ? [selfOption, ...students] : students;
  function resetForm() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setDate(today());
    setPriority("0");
    setItems([blank()]);
    setSelectedStudents(contextStudentId ? [contextStudentId] : selfOnly && selfOption ? [selfOption.studentId] : []);
  }
  function openNewPlan() {
    resetForm();
    setFormOpen(true);
  }
  function openEdit(plan: PlanLibraryDto, copy: boolean) {
    setEditing(copy ? null : { id: plan.id, revision: plan.revision });
    setTitle(copy ? `${plan.definition.title} 副本` : plan.definition.title);
    setDescription(plan.definition.description ?? "");
    setDate(plan.definition.startDate);
    setPriority(String(plan.priority));
    setItems(drafts(plan.definition));
    setSelectedStudents(contextStudentId ? [contextStudentId] : selfOnly && selfOption ? [selfOption.studentId] : []);
    setFormOpen(true);
  }
  const change = (index: number, key: keyof Draft, value: string) =>
    setItems((old) =>
      old.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    );
  const changePoints = (index: number, pointIndex: number, value: string) =>
    setItems((old) =>
      old.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              points: item.points.map((point, index) => (index === pointIndex ? value : point)),
            }
          : item,
      ),
    );
  async function activateStudents(planId: string, studentIds: string[]) {
    const results = await Promise.all(
      studentIds.map((studentId) => activatePlanLibrary(planId, studentId)),
    );
    return results.reduce((sum, result) => sum + result.itemsCreated, 0);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const planDefinition = definition(title, description, date, items);
      const result = editing
        ? await updatePlanLibrary(editing.id, editing.revision, planDefinition, Number(priority))
        : await savePlanLibrary(planDefinition, Number(priority));
      const itemsCreated =
        !editing && selectedStudents.length
          ? await activateStudents(result.plan.id, selectedStudents)
          : 0;
      setMessage(
        selectedStudents.length && !editing
          ? `计划已保存并绑定 ${selectedStudents.length} 名学生，生成 ${itemsCreated} 项日程`
          : editing
            ? "计划已更新，历史执行记录保持不变"
            : "计划已保存",
      );
      setFormOpen(false);
      resetForm();
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存计划失败");
    } finally {
      setSaving(false);
    }
  }
  function openAction(plan: PlanLibraryDto, kind: "bind" | "generate") {
    setAction({ plan, kind });
    const fixedStudentId = kind === "generate" ? contextStudentId ?? (selfOnly ? selfOption?.studentId : undefined) : undefined;
    setActionStudents(fixedStudentId ? [fixedStudentId] : []);
    const minimum = kind === "generate" ? earliestGenerateDate(plan, fixedStudentId ? [fixedStudentId] : []) : today();
    setRangeFrom(minimum);
    setRangeThrough(minimum);
  }
  async function executeAction(event: React.FormEvent) {
    event.preventDefault();
    if (!actionStudents.length) return setError("请至少选择一名学生");
    if (!action) return;
    setSaving(true);
    try {
      if (action.kind === "bind") {
        const itemsCreated = await activateStudents(action.plan.id, actionStudents);
        setMessage(`已绑定 ${actionStudents.length} 名学生，生成 ${itemsCreated} 项日程`);
      } else {
        const results = await Promise.all(
          actionStudents.map((studentId) =>
            generatePlanLibraryRange(action.plan.id, studentId, rangeFrom, rangeThrough),
          ),
        );
        const generatedFrom = results[0]?.generatedFrom;
        const generatedThrough = results[0]?.generatedThrough;
        setMessage(
          `已为 ${actionStudents.length} 名学生生成 ${results.reduce((sum, result) => sum + result.itemsCreated, 0)} 项日程${generatedFrom && generatedThrough ? `（实际日期 ${generatedFrom} 至 ${generatedThrough}）` : ""}`,
        );
      }
      setAction(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "操作失败");
    } finally {
      setSaving(false);
    }
  }
  async function removeBinding(planId: string, studentId: string) {
    setRemoving(`${planId}:${studentId}`);
    try {
      const result = await removePlanLibraryBinding(planId, studentId);
      setMessage(
        result.cancelledItems
          ? `已移除学生，并取消 ${result.cancelledItems} 项未开始日程`
          : "已移除学生",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "移除学生失败");
    } finally {
      setRemoving(null);
    }
  }
  if (loading)
    return (
      <PageShell title="计划">
        <LoadingState />
      </PageShell>
    );
  const actionCandidates =
    action?.kind === "bind"
      ? assignmentOptions.filter(
          (student) =>
            !action.plan.bindings.some((binding) => binding.studentId === student.studentId),
        )
      : assignmentOptions.filter((student) =>
          action?.plan.bindings.some((binding) => binding.studentId === student.studentId),
        );
  const minimumGenerateDate =
    action?.kind === "generate" ? earliestGenerateDate(action.plan, actionStudents) : today();
  const scopedPlans = contextStudentId
    ? plans.filter((plan) => plan.bindings.some((binding) => binding.studentId === contextStudentId))
    : selfOnly && selfOption
      ? plans.filter((plan) => plan.bindings.some((binding) => binding.studentId === selfOption.studentId))
      : plans;
  const visiblePlans = scopedPlans.filter((plan) => {
    const query = planQuery.trim().toLocaleLowerCase("zh-CN");
    const matchesQuery = !query || [plan.definition.title, ...plan.definition.entries.map((entry) => entry.title)].some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    const matchesStudent = !planStudentFilter || plan.bindings.some((binding) => binding.studentId === planStudentFilter);
    const matchesBinding = bindingFilter === "all" || (bindingFilter === "bound" ? plan.bindings.length > 0 : plan.bindings.length === 0);
    return matchesQuery && matchesStudent && matchesBinding;
  });
  return (
    <PageShell
      title="计划"
      subtitle="计划可复用；绑定后会生成未来 15 天日程"
      backHref={selfOnly ? "/account" : "/parent/students"}
      showLogout
      hideHeading
      secondaryNavigation={selfOnly ? undefined : <StudentManagementTabs />}
    >
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={message} onClose={() => setMessage(null)} />
      {removalTarget ? <ConfirmDialog
        title="移除计划绑定"
        message={`确定移除“${removalTarget.studentName}”与“${removalTarget.plan.definition.title}”的绑定吗？该学生未来未开始的该计划日程会被取消，已开始和已完成记录会保留。`}
        confirmLabel="确认移除"
        tone="danger"
        busy={removing === `${removalTarget.plan.id}:${removalTarget.studentId}`}
        onClose={() => setRemovalTarget(null)}
        onConfirm={() => void removeBinding(removalTarget.plan.id, removalTarget.studentId).then(() => setRemovalTarget(null))}
      /> : null}
      <section className="bd-library-toolbar">
        <div className="bd-library-toolbar-copy">
          <h2>{selfOnly ? "我的个人计划" : "计划列表"}</h2>
          <p>{selfOnly ? "个人计划只记录执行，不进入学生积分。" : "先查看与管理已有计划，再按需新增。"}</p>
        </div>
        <PrimaryButton
          type="button"
          fullWidth={false}
          data-testid="plan-library-create"
          onClick={openNewPlan}
        >
          新增计划
        </PrimaryButton>
      </section>
      {contextStudentId ? <StudentContextBanner studentId={contextStudentId} label="正在管理计划的学生" /> : null}
      {!selfOnly ? <section className="bd-filter-panel" aria-label="计划查询">
        <div className="bd-filter-fields bd-plan-filter-fields">
          <TextInput value={planQuery} onChange={(event) => setPlanQuery(event.target.value)} placeholder="搜索计划或内容名称" aria-label="搜索计划或内容名称" />
          {!contextStudentId ? <select value={planStudentFilter} onChange={(event) => setPlanStudentFilter(event.target.value)} aria-label="按学生筛选"><option value="">全部对象</option>{assignmentOptions.map((student) => <option key={student.studentId} value={student.studentId}>{student.displayName || student.username || "未命名成员"}</option>)}</select> : null}
          <select value={bindingFilter} onChange={(event) => setBindingFilter(event.target.value as "all" | "bound" | "unbound")} aria-label="按绑定状态筛选"><option value="all">全部状态</option><option value="bound">已绑定</option><option value="unbound">未绑定</option></select>
        </div>
        <div className="bd-filter-actions"><span className="text-sm text-slate-500">{visiblePlans.length} 个结果</span><SecondaryButton onClick={() => { setPlanQuery(""); setPlanStudentFilter(""); setBindingFilter("all"); }}>清空</SecondaryButton></div>
      </section> : null}
      {visiblePlans.length ? (
        <div className="bd-library-grid">
          {visiblePlans.map((plan) => (
            <article className="bd-library-card" key={plan.id}>
              <div className="bd-library-card-head">
                <h3 className="bd-library-card-title">{plan.definition.title}</h3>
                <span className="bd-library-count">{plan.definition.entries.length} 项内容</span>
              </div>
              <p className="bd-library-summary">
                {plan.definition.description || plan.definition.entries.map((entry) => entry.title).join("、")}
              </p>
              <div className="mt-2 space-y-1 text-sm text-slate-600">
                {(plan.bindings.length ? plan.bindings : [{ studentId: "__none__", displayName: "未绑定" }]).map((binding) => (
                  <div key={binding.studentId}>
                    <span className="font-medium">{binding.displayName}：</span>
                    <CompactGeneratedDates dates={plan.generatedDatesByStudent?.[binding.studentId] ?? []} />
                  </div>
                ))}
              </div>
              <div>
                <p className="bd-library-binding-label">已绑定对象 · 点击姓名可移除</p>
                {plan.bindings.length ? (
                  <div className="bd-library-binding-list">
                    {plan.bindings.map((binding) => (
                      <button
                        type="button"
                        className="bd-library-chip"
                        key={binding.studentId}
                        onClick={() => setRemovalTarget({ plan, studentId: binding.studentId, studentName: binding.displayName || binding.username || "未命名学生" })}
                        disabled={removing === `${plan.id}:${binding.studentId}`}
                      >
                        {binding.displayName || binding.username || "未命名学生"}{" "}
                        {removing === `${plan.id}:${binding.studentId}` ? "移除中…" : "×"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-neutral-500">尚未绑定对象</p>
                )}
              </div>
              <div className="bd-library-actions">
                <PrimaryButton
                  type="button"
                  fullWidth={false}
                  onClick={() => openEdit(plan, false)}
                >
                  编辑计划
                </PrimaryButton>
                <SecondaryButton onClick={() => openEdit(plan, true)}>复制</SecondaryButton>
                <SecondaryButton onClick={() => openAction(plan, "bind")}>添加学生</SecondaryButton>
                <SecondaryButton onClick={() => openAction(plan, "generate")}>生成日程</SecondaryButton>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-3xl border border-dashed p-6 text-center text-sm text-neutral-600">
          还没有计划，点击“新增计划”开始创建。
        </p>
      )}
      {formOpen ? (
        <Modal
          title={editing ? "编辑计划" : "新增计划"}
          onClose={() => {
            setFormOpen(false);
            resetForm();
          }}
        >
          <form className="space-y-3" onSubmit={save}>
            <Field label="计划名称">
              <TextInput
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field label="计划说明（可选）">
              <textarea
                maxLength={4000}
                className="min-h-24 w-full rounded-2xl border border-neutral-300 bg-white p-3"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="说明这个计划的学习目标、安排或注意事项"
              />
            </Field>
            <Field label="计划优先级（0–100，数字越大越优先）">
              <TextInput type="number" min="0" max="100" value={priority} onChange={(event) => setPriority(event.target.value)} />
            </Field>
            <Field label="开始日期">
              <TextInput
                required
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            {items.map((item, index) => (
              <fieldset className="space-y-2 rounded-2xl border p-3" key={index}>
                <legend>内容项 {index + 1}</legend>
                <Field label="名称">
                  <TextInput
                    required
                    value={item.title}
                    onChange={(event) => change(index, "title", event.target.value)}
                  />
                </Field>
                <Field label="内容说明（可选）">
                  <textarea
                    className="min-h-20 w-full rounded-2xl border p-3"
                    maxLength={500}
                    value={item.description}
                    onChange={(event) => change(index, "description", event.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="预期">
                    <TextInput
                      required
                      type="time"
                      value={item.time}
                      onChange={(event) => change(index, "time", event.target.value)}
                    />
                  </Field>
                  <Field label="最晚开始">
                    <TextInput
                      type="time"
                      value={item.latest}
                      onChange={(event) => change(index, "latest", event.target.value)}
                    />
                  </Field>
                </div>
                <Field label="时长上限（分钟，可选）">
                  <TextInput
                    type="number"
                    min="1"
                    value={item.duration}
                    onChange={(event) => change(index, "duration", event.target.value)}
                  />
                </Field>
                <Field label="重复">
                  <select
                    className="min-h-11 w-full rounded-2xl border p-2"
                    value={item.repeat}
                    onChange={(event) => change(index, "repeat", event.target.value)}
                  >
                    <option value="once">某天</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周星期</option>
                    <option value="monthly">每月几号</option>
                  </select>
                </Field>
                {item.repeat !== "daily" ? (
                  <Field label={item.repeat === "once" ? "日期" : "多个值用逗号分隔"}>
                    <TextInput
                      required
                      value={item.value}
                      onChange={(event) => change(index, "value", event.target.value)}
                    />
                  </Field>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  {["按时且时长内", "按时超时", "迟开始且时长内", "迟开始超时", "未完成"].map(
                    (label, pointIndex) => (
                      <Field label={label} key={label}>
                        <TextInput
                          required
                          type="number"
                          value={item.points[pointIndex]}
                          onChange={(event) => changePoints(index, pointIndex, event.target.value)}
                        />
                      </Field>
                    ),
                  )}
                </div>
                {items.length > 1 ? (
                  <PrimaryButton
                    type="button"
                    onClick={() =>
                      setItems((old) => old.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    删除此项
                  </PrimaryButton>
                ) : null}
              </fieldset>
            ))}
            <PrimaryButton type="button" onClick={() => setItems((old) => [...old, blank()])}>
              添加内容项
            </PrimaryButton>
            {!editing ? (
              <Field label="保存后绑定学生（可多选）">
                <StudentMultiSelect
                  students={assignmentOptions}
                  selectedIds={selectedStudents}
                  onChange={setSelectedStudents}
                  emptyLabel="暂不绑定"
                />
              </Field>
            ) : null}
            <PrimaryButton type="submit" disabled={saving} data-testid="plan-library-save">
              {saving ? "保存中…" : editing ? "保存修改" : "保存计划"}
            </PrimaryButton>
          </form>
        </Modal>
      ) : null}
      {action ? (
        <Modal
          title={
            action.kind === "bind"
              ? `为“${action.plan.definition.title}”添加学生`
              : `为“${action.plan.definition.title}”生成日程`
          }
          onClose={() => setAction(null)}
        >
          <form className="space-y-4" onSubmit={executeAction}>
            {action.kind === "generate" && (contextStudentId || selfOnly) ? <p className="rounded-2xl bg-[var(--bd-surface-soft)] p-3 text-sm text-slate-700">生成对象：{assignmentOptions.find((student) => student.studentId === actionStudents[0])?.displayName || "当前对象"}。此处只会生成该对象的日程。</p> : <StudentMultiSelect
              students={actionCandidates}
              selectedIds={actionStudents}
              onChange={(studentIds) => {
                setActionStudents(studentIds);
                if (action.kind === "generate") {
                  const minimum = earliestGenerateDate(action.plan, studentIds);
                  setRangeFrom((current) => maxDate(current, minimum));
                  setRangeThrough((current) => maxDate(current, minimum));
                }
              }}
              emptyLabel={action.kind === "bind" ? "没有可添加学生" : "没有已绑定学生"}
            />}
            {action.kind === "generate" ? (
              <div className="grid grid-cols-2 gap-2">
                <p className="col-span-2 text-xs text-neutral-600">
                  该计划从 {minimumGenerateDate} 起对所选学生生效；更早日期不可选择。
                </p>
                <Field label="开始日期">
                  <TextInput
                    required
                    type="date"
                    value={rangeFrom}
                    min={minimumGenerateDate}
                    onChange={(event) => setRangeFrom(maxDate(event.target.value, minimumGenerateDate))}
                  />
                </Field>
                <Field label="结束日期">
                  <TextInput
                    required
                    type="date"
                    value={rangeThrough}
                    min={maxDate(minimumGenerateDate, rangeFrom)}
                    onChange={(event) =>
                      setRangeThrough(maxDate(event.target.value, minimumGenerateDate, rangeFrom))
                    }
                  />
                </Field>
              </div>
            ) : null}
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? "处理中…" : action.kind === "bind" ? "绑定所选学生" : "生成所选日程"}
            </PrimaryButton>
          </form>
        </Modal>
      ) : null}
    </PageShell>
  );
}
