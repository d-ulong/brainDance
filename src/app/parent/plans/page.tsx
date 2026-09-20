"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
type ActivationSummary = {
  itemsCreated: number;
  matchedOccurrences: number;
  generatedFrom: string;
  generatedThrough: string;
};
function maxDate(...dates: string[]) {
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}
function minDate(...dates: string[]) {
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}
function formatActivationSummary(prefix: string, results: ActivationSummary[]) {
  const itemsCreated = results.reduce((sum, result) => sum + result.itemsCreated, 0);
  const matchedOccurrences = results.reduce((sum, result) => sum + result.matchedOccurrences, 0);
  const generatedFrom = minDate(...results.map((result) => result.generatedFrom));
  const generatedThrough = maxDate(...results.map((result) => result.generatedThrough));
  if (itemsCreated > 0) {
    return `${prefix}，生成 ${itemsCreated} 项日程（实际日期 ${generatedFrom} 至 ${generatedThrough}）`;
  }
  if (matchedOccurrences === 0) {
    return `${prefix}，未新增日程：该重复规则在 ${generatedFrom} 至 ${generatedThrough} 范围内没有匹配日期`;
  }
  return `${prefix}，未新增日程：幂等回放（实际日期 ${generatedFrom} 至 ${generatedThrough}）`;
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

function entryMaxPoints(entry: PlanDefinitionDto["entries"][number]) {
  return Math.max(
    0,
    entry.points.onTimeWithin,
    entry.points.onTimeOver,
    entry.points.lateWithin,
    entry.points.lateOver,
    entry.points.incomplete,
  );
}

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
  return (
    <Suspense fallback={<PageShell title="计划"><LoadingState /></PageShell>}>
      <ParentPlansPageContent />
    </Suspense>
  );
}

function ParentPlansPageContent() {
  const router = useRouter();
  const params = useParams<{ studentId?: string }>();
  const searchParams = useSearchParams();
  const contextStudentId = params.studentId;
  const selfOnly = searchParams.get("scope") === "self";
  const [plans, setPlans] = useState<PlanLibraryDto[]>([]);
  const [students, setStudents] = useState<LinkedStudentDto[]>([]);
  const [selfOption, setSelfOption] = useState<LinkedStudentDto | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("0");
  const [items, setItems] = useState<Draft[]>([blank()]);
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
  const [previewPlan, setPreviewPlan] = useState<PlanLibraryDto | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
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
    setTitle("");
    setDescription("");
    setPriority("0");
    setItems([blank()]);
  }
  function openNewPlan() {
    const scope = selfOnly ? "?scope=self" : "";
    router.push(`/parent/plans/new${scope}`);
  }
  function openEdit(plan: PlanLibraryDto, copy: boolean) {
    if (!copy) {
      const scope = selfOnly ? "?scope=self" : "";
      router.push(`/parent/plans/${plan.id}/edit${scope}`);
      return;
    }
    setTitle(`${plan.definition.title} 副本`);
    setDescription(plan.definition.description ?? "");
    setPriority(String(plan.priority));
    setItems(drafts(plan.definition));
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
    return Promise.all(studentIds.map((studentId) => activatePlanLibrary(planId, studentId)));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const planDefinition = definition(title, description, today(), items);
      const result = await savePlanLibrary(planDefinition, Number(priority));
      setFormOpen(false);
      resetForm();
      const scope = selfOnly ? "?scope=self" : "";
      router.push(`/parent/plans/${result.plan.id}/edit${scope}`);
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
    const day = today();
    setRangeFrom(day);
    setRangeThrough(day);
  }
  async function executeAction(event: React.FormEvent) {
    event.preventDefault();
    if (!actionStudents.length) return setError("请至少选择一名学生");
    if (!action) return;
    if (action.kind === "generate" && rangeThrough < rangeFrom) {
      return setError("结束日期不能早于开始日期");
    }
    setSaving(true);
    try {
      if (action.kind === "bind") {
        const activationResults = await activateStudents(action.plan.id, actionStudents);
        setMessage(
          formatActivationSummary(`已绑定 ${actionStudents.length} 名学生`, activationResults),
        );
      } else {
        const results = await Promise.all(
          actionStudents.map((studentId) =>
            generatePlanLibraryRange(action.plan.id, studentId, rangeFrom, rangeThrough),
          ),
        );
        const itemsCreated = results.reduce((sum, result) => sum + result.itemsCreated, 0);
        const generatedFrom = results[0]?.generatedFrom;
        const generatedThrough = results[0]?.generatedThrough;
        if (itemsCreated > 0) {
          setMessage(
            `已为 ${actionStudents.length} 名学生生成 ${itemsCreated} 项日程${generatedFrom && generatedThrough ? `（实际日期 ${generatedFrom} 至 ${generatedThrough}）` : ""}`,
          );
        } else if (results.every((result) => result.idempotentReplay)) {
          setMessage(
            `未新增日程：幂等回放${generatedFrom && generatedThrough ? `（实际日期 ${generatedFrom} 至 ${generatedThrough}）` : ""}`,
          );
        } else {
          setMessage(
            `未新增日程：该重复规则在${generatedFrom && generatedThrough ? ` ${generatedFrom} 至 ${generatedThrough}` : "所选"}范围内没有匹配日期`,
          );
        }
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
  const generateDateMin = today();
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
      workspace="parent"
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
          <p>{selfOnly ? "个人计划可开始/完成并按规则记积分，仅用于个人记录，不进入学生兑换。" : "先查看与管理已有计划，再按需新增。"}</p>
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
      {!selfOnly ? (
        <section className="bd-filter-panel" aria-label="计划查询">
          <TextInput
            value={planQuery}
            onChange={(event) => setPlanQuery(event.target.value)}
            placeholder="搜索计划或内容名称"
            aria-label="搜索计划或内容名称"
          />
          <div className="bd-filter-actions w-full flex-wrap">
            <span className="text-sm text-slate-500">{visiblePlans.length} 个结果</span>
            <SecondaryButton type="button" onClick={() => setFiltersExpanded((open) => !open)}>
              {filtersExpanded ? "收起筛选" : "更多筛选"}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => {
                setPlanQuery("");
                setPlanStudentFilter("");
                setBindingFilter("all");
              }}
            >
              清空
            </SecondaryButton>
          </div>
          {filtersExpanded ? (
            <div className="bd-filter-fields bd-plan-filter-fields w-full">
              {!contextStudentId ? (
                <select
                  value={planStudentFilter}
                  onChange={(event) => setPlanStudentFilter(event.target.value)}
                  aria-label="按学生筛选"
                >
                  <option value="">全部对象</option>
                  {assignmentOptions.map((student) => (
                    <option key={student.studentId} value={student.studentId}>
                      {student.displayName || student.username || "未命名成员"}
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                value={bindingFilter}
                onChange={(event) => setBindingFilter(event.target.value as "all" | "bound" | "unbound")}
                aria-label="按绑定状态筛选"
              >
                <option value="all">全部状态</option>
                <option value="bound">已绑定</option>
                <option value="unbound">未绑定</option>
              </select>
            </div>
          ) : null}
        </section>
      ) : null}
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
                <SecondaryButton onClick={() => setPreviewPlan(plan)}>预览</SecondaryButton>
                <SecondaryButton onClick={() => openEdit(plan, true)}>复制</SecondaryButton>
                <SecondaryButton onClick={() => openAction(plan, "bind")}>添加学生</SecondaryButton>
                <SecondaryButton onClick={() => openAction(plan, "generate")}>生成日程</SecondaryButton>
              </div>
            </article>
          ))}
        </div>
      ) : scopedPlans.length ? (
        <div className="bd-empty" data-testid="plan-filter-empty">
          <span aria-hidden="true">🔍</span>
          <h3>没有匹配的计划</h3>
          <p>试试调整搜索词或筛选条件。</p>
          <SecondaryButton
            onClick={() => {
              setPlanQuery("");
              setPlanStudentFilter("");
              setBindingFilter("all");
            }}
          >
            清空筛选
          </SecondaryButton>
        </div>
      ) : (
        <div className="bd-empty" data-testid="plan-library-empty">
          <span aria-hidden="true">🗂️</span>
          <h3>还没有计划</h3>
          <p>点击“新增计划”开始创建。</p>
        </div>
      )}
      {formOpen ? (
        <Modal
          title="复制计划"
          onClose={() => {
            if (!window.confirm("确定关闭并放弃复制内容吗？")) return;
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
            <p className="text-sm text-[var(--bd-muted)]">
              保存后会进入编辑页，可在「适用对象」中单独保存绑定变更。
            </p>
            <div className="bd-plan-edit-footer grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SecondaryButton type="button" onClick={() => setFormOpen(false)} className="w-full min-h-11">
                取消
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={saving} data-testid="plan-library-save">
                {saving ? "保存中…" : "保存副本并继续编辑"}
              </PrimaryButton>
            </div>
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
              onChange={(studentIds) => setActionStudents(studentIds)}
              emptyLabel={action.kind === "bind" ? "没有可添加学生" : "没有已绑定学生"}
            />}
            {action.kind === "generate" ? (
              <div className="grid grid-cols-2 gap-2">
                <p className="col-span-2 text-xs text-[var(--bd-muted)]">
                  可选择今天至未来的日期范围；若早于计划对该学生的生效日，服务器会返回明确错误。
                </p>
                <Field label="开始日期">
                  <TextInput
                    required
                    type="date"
                    value={rangeFrom}
                    min={generateDateMin}
                    data-testid="plan-generate-from"
                    onChange={(event) => {
                      const next = event.target.value;
                      setRangeFrom(next);
                      if (rangeThrough < next) setRangeThrough(next);
                    }}
                  />
                </Field>
                <Field label="结束日期">
                  <TextInput
                    required
                    type="date"
                    value={rangeThrough}
                    min={rangeFrom}
                    data-testid="plan-generate-through"
                    onChange={(event) => setRangeThrough(event.target.value)}
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
      {previewPlan ? (
        <Modal title={`预览：${previewPlan.definition.title}`} onClose={() => setPreviewPlan(null)}>
          <p className="mb-3 text-sm text-slate-600">点击任务名称、时间或最高积分即可进入编辑。</p>
          <ul className="space-y-2">
            {previewPlan.definition.entries.map((entry) => (
              <li key={entry.key} className="rounded-2xl border border-[var(--bd-border)] p-3">
                <div className="flex flex-wrap gap-3 text-sm">
                  <button
                    type="button"
                    className="font-semibold text-[var(--bd-primary)]"
                    onClick={() => {
                      setPreviewPlan(null);
                      openEdit(previewPlan, false);
                    }}
                  >
                    {entry.title}
                  </button>
                  <button
                    type="button"
                    className="text-slate-700 underline-offset-2 hover:underline"
                    onClick={() => {
                      setPreviewPlan(null);
                      openEdit(previewPlan, false);
                    }}
                  >
                    时间 {entry.expectedTime}
                  </button>
                  <button
                    type="button"
                    className="text-slate-700 underline-offset-2 hover:underline"
                    onClick={() => {
                      setPreviewPlan(null);
                      openEdit(previewPlan, false);
                    }}
                  >
                    最高积分 {entryMaxPoints(entry)}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </PageShell>
  );
}
