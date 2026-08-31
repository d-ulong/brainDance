"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  formatMetricLabel,
  formatMetricValue,
  formatSessionKind,
  formatTrainingKeyLabel,
} from "@/components/training/metric-labels";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { TrendsPanel } from "@/components/training/trends-panel";
import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";
import {
  fetchTrainingSummary,
  TRAINING_OPTIONS,
  type TrainingKey,
  type TrainingSummary,
} from "@/lib/client/training-api";

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
  const [studentId, setStudentId] = useState<string | null>(null);
  const [relationshipId, setRelationshipId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [trainingKey, setTrainingKey] = useState<TrainingKey>("reaction");
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const loadData = useCallback(async (sid: string, key: TrainingKey) => {
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
      const result = await fetchTrainingSummary(sid, key);
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
      setStudentId(sid);

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
        await loadData(sid, trainingKey);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData, params, router, trainingKey]);

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
      <TrainingDisclaimer />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="训练类型">
        {TRAINING_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={trainingKey === option.key}
            data-testid={`parent-training-key-${option.key}`}
            onClick={() => setTrainingKey(option.key)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-1 ${
              trainingKey === option.key
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            {option.title}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="text-sm font-semibold">{formatTrainingKeyLabel(trainingKey)} 最近记录</h2>
        {summary?.lastSession ? (
          <>
            <p className="mt-2 text-sm text-neutral-600">
              最近会话：
              <span data-testid="last-session-id">
                {summary.lastSession.sessionId.slice(0, 8)}…
              </span>
              · {formatSessionKind(summary.lastSession.sessionKind)}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {summary.lastSession.metrics.map((metric) => (
                <li
                  key={metric.metricKey}
                  data-testid={`parent-metric-${metric.metricKey}`}
                  className="flex justify-between gap-2 text-sm"
                >
                  <span>{formatMetricLabel(metric.metricKey)}</span>
                  <span className="font-medium">
                    {formatMetricValue(metric.value, metric.unit)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-neutral-500">
              家长仅可查看汇总与趋势，不能修改原始成绩。
            </p>
          </>
        ) : (
          <Alert tone="info" className="mt-2">
            该学生尚无已完成 {formatTrainingKeyLabel(trainingKey)} 记录。
          </Alert>
        )}
      </section>

      {studentId ? (
        <TrendsPanel studentId={studentId} trainingKey={trainingKey} testIdPrefix="parent-trends" />
      ) : null}

      {relationshipId ? (
        <PrimaryButton disabled={ending} onClick={() => void endRelationshipAction()}>
          {ending ? "解除中…" : "解除关联"}
        </PrimaryButton>
      ) : null}
    </PageShell>
  );
}
