"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useState } from "react";

import { PlanLibraryEditForm } from "@/components/plans/plan-library-edit-form";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { LoadingState, PageShell, Toast } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import { fetchPlanLibrary, updatePlanLibrary, type PlanLibraryDto } from "@/lib/client/m2-api";

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
        }
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
      await updatePlanLibrary(plan.id, plan.revision, definition, priority);
      setMessage("计划已更新");
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
          onSubmit={(definition, priority) => {
            setDirty(true);
            return save(definition, priority);
          }}
        />
      ) : (
        <p className="text-sm text-[var(--bd-muted)]">未找到可编辑的计划。</p>
      )}
    </PageShell>
  );
}
