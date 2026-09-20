"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";

import { PlanLibraryEditForm } from "@/components/plans/plan-library-edit-form";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { LoadingState, PageShell, Toast } from "@/components/ui/page-shell";
import { useUnsavedChangesGuard } from "@/components/ui/use-unsaved-changes-guard";
import { ApiError, fetchSession } from "@/lib/client/api";
import { fetchPlanLibrary, updatePlanLibrary, type PlanLibraryDto } from "@/lib/client/m2-api";

export default function StudentPlanEditPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const router = useRouter();
  const [plan, setPlan] = useState<PlanLibraryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveLock = useRef(false);
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") {
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
        }
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "加载计划失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [planId, router]);

  async function save(definition: Parameters<typeof updatePlanLibrary>[2], priority: number) {
    if (!plan || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
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
      setMessage("计划已更新，已有日程保持不变");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败");
    } finally {
      setSaving(false);
      saveLock.current = false;
    }
  }

  function cancel() {
    if (dirty && !window.confirm("有未保存的修改，确定离开吗？")) return;
    router.push("/student/plans");
  }

  return (
    <PageShell
      title="编辑计划"
      showLogout
      backHref="/student/plans"
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
          onValidationError={setError}
          onSubmit={(definition, priority) => save(definition, priority)}
        />
      ) : (
        <p className="text-sm text-[var(--bd-muted)]">未找到可编辑的计划。</p>
      )}
    </PageShell>
  );
}
