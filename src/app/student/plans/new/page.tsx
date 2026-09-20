"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlanLibraryEditForm } from "@/components/plans/plan-library-edit-form";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { PageShell, PrimaryButton, Toast } from "@/components/ui/page-shell";
import { useUnsavedChangesGuard } from "@/components/ui/use-unsaved-changes-guard";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  activatePlanLibrary,
  savePlanLibrary,
  todayFamilyDate,
  type PlanLibraryDto,
} from "@/lib/client/m2-api";
import { planLibraryCreateTemplate } from "@/lib/plans/plan-create-template";

export default function StudentPlanNewPage() {
  const router = useRouter();
  const [startDate] = useState(todayFamilyDate());
  const template = useMemo(() => planLibraryCreateTemplate(startDate), [startDate]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [createdPlan, setCreatedPlan] = useState<Pick<PlanLibraryDto, "id" | "revision"> | null>(
    null,
  );
  const [studentId, setStudentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const saveLock = useRef(false);
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      setStudentId(session.userId);
    })();
  }, [router]);

  async function createPlan(
    definition: Parameters<typeof savePlanLibrary>[0],
    priority: number,
  ) {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await savePlanLibrary(definition, priority);
      setCreatedPlan({ id: result.plan.id, revision: result.plan.revision });
      setMessage("计划已保存。可继续编辑，或启用计划生成日程。");
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存计划失败");
    } finally {
      setSaving(false);
      saveLock.current = false;
    }
  }

  async function activateSavedPlan() {
    if (!createdPlan || !studentId || activating) return;
    setActivating(true);
    setError(null);
    try {
      const activation = await activatePlanLibrary(createdPlan.id, studentId, startDate);
      if (activation.itemsCreated > 0) {
        setMessage(
          `计划已启用，并生成 ${activation.itemsCreated} 项日程（实际日期 ${activation.generatedFrom} 至 ${activation.generatedThrough}）`,
        );
      } else {
        setMessage("计划已启用。");
      }
      router.push("/student/plans");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "启用计划失败");
    } finally {
      setActivating(false);
    }
  }

  function cancel() {
    if (dirty && !window.confirm("有未保存的修改，确定离开吗？")) return;
    router.push("/student/plans");
  }

  return (
    <PageShell
      title="制定新计划"
      showLogout
      backHref="/student/plans"
      onBeforeNavigate={async () => {
        if (!dirty) return true;
        return window.confirm("有未保存的修改，确定离开吗？");
      }}
    >
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={message} onClose={() => setMessage(null)} />
      <PlanLibraryEditForm
        plan={template}
        saving={saving}
        submitLabel="保存计划"
        onCancel={cancel}
        onDirtyChange={setDirty}
        onValidationError={setError}
        onSubmit={(definition, priority) => createPlan(definition, priority)}
      />
      {createdPlan ? (
        <div className="mt-4 max-w-3xl">
          <PrimaryButton
            type="button"
            disabled={activating || saving}
            onClick={() => void activateSavedPlan()}
            data-testid="student-plan-activate"
          >
            {activating ? "启用中…" : "启用计划并生成日程"}
          </PrimaryButton>
        </div>
      ) : null}
    </PageShell>
  );
}
