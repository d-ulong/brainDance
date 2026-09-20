"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";

import { PlanLibraryEditForm } from "@/components/plans/plan-library-edit-form";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { StudentMultiSelect } from "@/components/ui/student-multi-select";
import { Field, LoadingState, PageShell, PrimaryButton, Toast } from "@/components/ui/page-shell";
import { useUnsavedChangesGuard } from "@/components/ui/use-unsaved-changes-guard";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  activatePlanLibrary,
  fetchLinkedStudents,
  fetchPlanLibrary,
  removePlanLibraryBinding,
  updatePlanLibrary,
  type LinkedStudentDto,
  type PlanLibraryDto,
} from "@/lib/client/m2-api";

export default function ParentPlanEditPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const scopeSelf = search.get("scope") === "self";
  const [plan, setPlan] = useState<PlanLibraryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDefinition, setSavingDefinition] = useState(false);
  const [savingBindings, setSavingBindings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [definitionDirty, setDefinitionDirty] = useState(false);
  const [students, setStudents] = useState<LinkedStudentDto[]>([]);
  const [selfOption, setSelfOption] = useState<LinkedStudentDto | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const saveDefinitionLock = useRef(false);

  const bindingDirty = useMemo(() => {
    if (!plan) return false;
    const previous = new Set(plan.bindings.map((binding) => binding.studentId));
    const next = new Set(selectedStudents);
    if (previous.size !== next.size) return true;
    for (const studentId of previous) {
      if (!next.has(studentId)) return true;
    }
    return false;
  }, [plan, selectedStudents]);

  useUnsavedChangesGuard(definitionDirty || bindingDirty);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      try {
        const library = await fetchPlanLibrary();
        if (cancelled) return;
        const match = library.plans.find((row) => row.id === planId);
        if (!match?.canEdit) {
          setError("无法编辑该计划，可能无权限或计划不存在。");
        } else {
          setPlan(match);
          setSelectedStudents(match.bindings.map((binding) => binding.studentId));
        }
        setSelfOption({
          studentId: session.userId,
          displayName: `${session.displayName || session.account || "我"}（我的个人计划）`,
          username: session.account ?? null,
        });
        const linked = await fetchLinkedStudents();
        if (!cancelled) setStudents(linked.students);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : "加载计划失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, router, scopeSelf]);

  async function saveDefinition(
    definition: Parameters<typeof updatePlanLibrary>[2],
    priority: number,
  ) {
    if (!plan || saveDefinitionLock.current) return;
    saveDefinitionLock.current = true;
    setSavingDefinition(true);
    setError(null);
    try {
      const result = await updatePlanLibrary(plan.id, plan.revision, definition, priority);
      setPlan((current) =>
        current
          ? {
              ...current,
              revision: result.plan.revision,
              definition: result.plan.definition,
              priority,
            }
          : current,
      );
      setMessage("计划定义已保存");
      setDefinitionDirty(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "计划定义保存失败");
    } finally {
      setSavingDefinition(false);
      saveDefinitionLock.current = false;
    }
  }

  async function applyBindings() {
    if (!plan || !bindingDirty || savingBindings) return;
    setSavingBindings(true);
    setError(null);
    const previousIds = new Set(plan.bindings.map((binding) => binding.studentId));
    const nextIds = new Set(selectedStudents);
    const toAdd = selectedStudents.filter((studentId) => !previousIds.has(studentId));
    const toRemove = [...previousIds].filter((studentId) => !nextIds.has(studentId));
    const added: string[] = [];
    const removed: string[] = [];
    const failures: string[] = [];

    try {
      for (const studentId of toAdd) {
        try {
          await activatePlanLibrary(plan.id, studentId);
          added.push(studentId);
        } catch (cause) {
          failures.push(
            `新增绑定失败（${studentId.slice(0, 8)}…）：${
              cause instanceof ApiError ? cause.message : "未知错误"
            }`,
          );
        }
      }
      for (const studentId of toRemove) {
        try {
          await removePlanLibraryBinding(plan.id, studentId);
          removed.push(studentId);
        } catch (cause) {
          failures.push(
            `移除绑定失败（${studentId.slice(0, 8)}…）：${
              cause instanceof ApiError ? cause.message : "未知错误"
            }`,
          );
        }
      }

      const library = await fetchPlanLibrary();
      const refreshed = library.plans.find((row) => row.id === plan.id);
      if (refreshed) {
        setPlan(refreshed);
        setSelectedStudents(refreshed.bindings.map((binding) => binding.studentId));
      }

      if (added.length || removed.length) {
        setMessage(`绑定已更新（+${added.length}/-${removed.length}）`);
      }
      if (failures.length) {
        setError(
          [
            added.length || removed.length
              ? `部分绑定已生效（+${added.length}/-${removed.length}），但仍有失败项：`
              : "绑定更新失败：",
            ...failures,
          ].join("\n"),
        );
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "绑定更新失败");
    } finally {
      setSavingBindings(false);
    }
  }

  function cancel() {
    if ((definitionDirty || bindingDirty) && !window.confirm("有未保存的修改，确定离开吗？")) return;
    router.push(scopeSelf ? "/parent/plans?scope=self" : "/parent/plans");
  }

  return (
    <PageShell
      title="编辑计划"
      showLogout
      backHref={scopeSelf ? "/parent/plans?scope=self" : "/parent/plans"}
      workspace="parent"
      onBeforeNavigate={async () => {
        if (!definitionDirty && !bindingDirty) return true;
        return window.confirm("有未保存的修改，确定离开吗？");
      }}
    >
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={message} onClose={() => setMessage(null)} />
      {loading ? (
        <LoadingState />
      ) : plan ? (
        <PlanLibraryEditForm
          plan={plan}
          saving={savingDefinition}
          onCancel={cancel}
          onDirtyChange={setDefinitionDirty}
          onValidationError={setError}
          bindingsSection={
            scopeSelf ? (
              <p className="text-sm text-[var(--bd-muted)]">个人计划仅用于家长本人记录。</p>
            ) : (
              <div className="space-y-3">
                <Field label="绑定学生（可继续增删）">
                  <StudentMultiSelect
                    students={selfOption ? [selfOption, ...students] : students}
                    selectedIds={selectedStudents}
                    onChange={setSelectedStudents}
                    emptyLabel="暂不绑定"
                  />
                </Field>
                {bindingDirty ? (
                  <PrimaryButton
                    type="button"
                    disabled={savingBindings || savingDefinition}
                    onClick={() => void applyBindings()}
                    data-testid="plan-edit-save-bindings"
                  >
                    {savingBindings ? "绑定保存中…" : "保存绑定变更"}
                  </PrimaryButton>
                ) : null}
              </div>
            )
          }
          onSubmit={(definition, priority) => saveDefinition(definition, priority)}
        />
      ) : (
        <p className="text-sm text-[var(--bd-muted)]">未找到可编辑的计划。</p>
      )}
    </PageShell>
  );
}
