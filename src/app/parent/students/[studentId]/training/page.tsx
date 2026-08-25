"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";

type TrainingSummary = {
  studentId: string;
  trainingKey: string;
  lastSession: {
    sessionId: string;
    status: string;
    sessionKind: string | null;
    metrics: Array<{ metricKey: string; value: number }>;
  } | null;
};

type LinkedStudent = {
  studentId: string;
  relationshipId: string;
  displayName: string;
};

export default function ParentTrainingSummaryPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const router = useRouter();
  const [relationshipId, setRelationshipId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const loadData = useCallback(async (sid: string) => {
    setError(null);
    setForbidden(false);

    try {
      const profile = await apiFetch<{ displayName: string }>(
        `/api/family/students/${sid}/profile`,
      );
      setProfileName(profile.displayName);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return;
      }
      throw err;
    }

    try {
      const result = await apiFetch<TrainingSummary>(
        `/api/students/${sid}/training-summary?trainingKey=reaction`,
      );
      setSummary(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return;
      }
      throw err;
    }

    const linked = await apiFetch<{ students: LinkedStudent[] }>("/api/family/students");
    const match = linked.students.find((student) => student.studentId === sid);
    if (match) {
      setRelationshipId(match.relationshipId);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      const sid = resolved.studentId;

      const session = await fetchSession();
      if (!session || session.role !== "parent") {
        router.replace("/login");
        return;
      }
      if (!session.contactVerified) {
        router.replace("/verify-contact");
        return;
      }

      try {
        await loadData(sid);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData, params, router]);

  async function endRelationshipAction() {
    if (!relationshipId) return;
    setEnding(true);
    setError(null);
    try {
      await apiFetch(`/api/relationships/${relationshipId}/end`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: newIdempotencyKey("end-relationship") }),
      });
      setSummary(null);
      setProfileName(null);
      setForbidden(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "解除关联失败");
    } finally {
      setEnding(false);
    }
  }

  if (loading) {
    return (
      <PageShell title="训练汇总">
        <LoadingState />
      </PageShell>
    );
  }

  if (forbidden) {
    return (
      <PageShell title="训练汇总" backHref="/parent/students" showLogout>
        <Alert tone="error" data-testid="parent-forbidden">
          无权限访问该学生数据。关联可能已解除或尚未建立。
        </Alert>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="训练汇总" backHref="/parent/students" showLogout>
        <Alert tone="error">{error}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={profileName ? `${profileName} 的训练汇总` : "训练汇总"}
      backHref="/parent/students"
      showLogout
    >
      {summary?.lastSession ? (
        <section className="rounded-xl border border-neutral-300 bg-white p-4">
          <p className="text-sm text-neutral-600">
            最近会话：
            <span data-testid="last-session-id">{summary.lastSession.sessionId.slice(0, 8)}…</span>
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {summary.lastSession.metrics.map((metric) => (
              <li
                key={metric.metricKey}
                data-testid={`parent-metric-${metric.metricKey}`}
                className="flex justify-between text-sm"
              >
                <span>{metric.metricKey}</span>
                <span className="font-medium">{metric.value}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Alert tone="info">该学生尚无已完成训练记录。</Alert>
      )}

      {relationshipId ? (
        <PrimaryButton disabled={ending} onClick={() => void endRelationshipAction()}>
          {ending ? "解除中…" : "解除关联"}
        </PrimaryButton>
      ) : null}
    </PageShell>
  );
}
