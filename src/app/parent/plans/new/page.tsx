"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { PlanLibraryEditForm } from "@/components/plans/plan-library-edit-form";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { LoadingState, PageShell, Toast } from "@/components/ui/page-shell";
import { useUnsavedChangesGuard } from "@/components/ui/use-unsaved-changes-guard";
import { ApiError, fetchSession } from "@/lib/client/api";
import { savePlanLibrary } from "@/lib/client/m2-api";
import { planLibraryCreateTemplate } from "@/lib/plans/plan-create-template";

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

function ParentPlanNewPageContent() {
  const router = useRouter();
  const search = useSearchParams();
  const scopeSelf = search.get("scope") === "self";
  const [startDate] = useState(today());
  const template = useMemo(() => planLibraryCreateTemplate(startDate), [startDate]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveLock = useRef(false);
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
      }
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
      setDirty(false);
      const scope = scopeSelf ? "?scope=self" : "";
      router.push(`/parent/plans/${result.plan.id}/edit${scope}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存计划失败");
    } finally {
      setSaving(false);
      saveLock.current = false;
    }
  }

  function cancel() {
    if (dirty && !window.confirm("有未保存的修改，确定离开吗？")) return;
    router.push(scopeSelf ? "/parent/plans?scope=self" : "/parent/plans");
  }

  return (
    <PageShell
      title="新增计划"
      showLogout
      backHref={scopeSelf ? "/parent/plans?scope=self" : "/parent/plans"}
      workspace="parent"
      onBeforeNavigate={async () => {
        if (!dirty) return true;
        return window.confirm("有未保存的修改，确定离开吗？");
      }}
    >
      <ErrorDialog message={error} onClose={() => setError(null)} />
      <Toast message={null} onClose={() => undefined} />
      <PlanLibraryEditForm
        plan={template}
        saving={saving}
        submitLabel="保存计划"
        onCancel={cancel}
        onDirtyChange={setDirty}
        onValidationError={setError}
        onSubmit={(definition, priority) => createPlan(definition, priority)}
      />
    </PageShell>
  );
}

export default function ParentPlanNewPage() {
  return (
    <Suspense fallback={<PageShell title="新增计划"><LoadingState /></PageShell>}>
      <ParentPlanNewPageContent />
    </Suspense>
  );
}
