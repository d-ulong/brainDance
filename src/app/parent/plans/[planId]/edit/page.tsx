"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useState } from "react";

import { PlanLibraryEditForm } from "@/components/plans/plan-library-edit-form";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { StudentMultiSelect } from "@/components/ui/student-multi-select";
import { Field, LoadingState, PageShell, Toast } from "@/components/ui/page-shell";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [students, setStudents] = useState<LinkedStudentDto[]>([]);
  const [selfOption, setSelfOption] = useState<LinkedStudentDto | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      try {
        const library = await fetchPlanLibrary();
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
        setStudents(linked.students);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "加载计划失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [planId, router, scopeSelf]);

  async function save(definition: Parameters<typeof updatePlanLibrary>[2], priority: number) {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updatePlanLibrary(plan.id, plan.revision, definition, priority);
      const previousIds = new Set(plan.bindings.map((binding) => binding.studentId));
      const nextIds = new Set(selectedStudents);
      const toAdd = selectedStudents.filter((studentId) => !previousIds.has(studentId));
      const toRemove = [...previousIds].filter((studentId) => !nextIds.has(studentId));
      if (toAdd.length) {
        await Promise.all(toAdd.map((studentId) => activatePlanLibrary(result.plan.id, studentId)));
      }
      for (const studentId of toRemove) {
        await removePlanLibraryBinding(result.plan.id, studentId);
      }
      const bindNote =
        toAdd.length || toRemove.length ? `；绑定已更新（+${toAdd.length}/-${toRemove.length}）` : "";
      setMessage(`计划已更新${bindNote}`);
      setDirty(false);
      router.push(scopeSelf ? "/parent/plans?scope=self" : "/parent/plans");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty && !window.confirm("有未保存的修改，确定离开吗？")) return;
    router.push(scopeSelf ? "/parent/plans?scope=self" : "/parent/plans");
  }

  return (
    <PageShell
      title="编辑计划"
      showLogout
      backHref={scopeSelf ? "/parent/plans?scope=self" : "/parent/plans"}
      workspace="parent"
      onBeforeNavigate={async () => {
        if (!dirty) return true;
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
          saving={saving}
          onCancel={cancel}
          onDirtyChange={setDirty}
          bindingsSection={
            scopeSelf ? (
              <p className="text-sm text-[var(--bd-muted)]">个人计划仅用于家长本人记录。</p>
            ) : (
              <Field label="绑定学生（可继续增删）">
                <StudentMultiSelect
                  students={selfOption ? [selfOption, ...students] : students}
                  selectedIds={selectedStudents}
                  onChange={(studentIds) => {
                    setDirty(true);
                    setSelectedStudents(studentIds);
                  }}
                  emptyLabel="暂不绑定"
                />
              </Field>
            )
          }
          onSubmit={(definition, priority) => save(definition, priority)}
        />
      ) : (
        <p className="text-sm text-[var(--bd-muted)]">未找到可编辑的计划。</p>
      )}
    </PageShell>
  );
}
