"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  formatAgeBand,
  formatMetricLabel,
  formatMetricValue,
  formatSessionKind,
  formatTrainingKeyLabel,
} from "@/components/training/metric-labels";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { TrainingSessionReview } from "@/components/training/training-session-review";
import { TrendsPanel } from "@/components/training/trends-panel";
import { StudentContextBanner } from "@/components/ui/student-context-banner";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  fetchStudentTrainingSession,
  type TrainingSessionDetail,
} from "@/lib/client/training-api";

export default function ParentStudentTrainingResultPage({
  params,
}: {
  params: Promise<{ studentId: string; sessionId: string }>;
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [detail, setDetail] = useState<TrainingSessionDetail | null>(null);

  const loadSession = useCallback(async (sid: string, id: string) => {
    setError(null);
    setForbidden(false);
    try {
      const data = await fetchStudentTrainingSession(sid, id);
      setDetail(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      setStudentId(resolved.studentId);
      setSessionId(resolved.sessionId);

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
        await loadSession(resolved.studentId, resolved.sessionId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "无法加载训练结果");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSession, params, router]);

  const backHref = studentId ? `/parent/students/${studentId}/training` : "/parent/students";

  if (loading) {
    return (
      <PageShell title="学生训练结果">
        <LoadingState />
      </PageShell>
    );
  }

  if (forbidden) {
    return (
      <PageShell title="学生训练结果" backHref={backHref} showLogout>
        <Alert tone="error" data-testid="parent-forbidden">
          无权限访问该学生数据。关联可能已解除或尚未建立。
        </Alert>
      </PageShell>
    );
  }

  if (error || !detail) {
    return (
      <PageShell title="学生训练结果" backHref={backHref} showLogout>
        <Alert tone="error">{error ?? "未找到训练结果"}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={formatTrainingKeyLabel(detail.trainingKey)}
      subtitle={`会话 ${sessionId?.slice(0, 8)}…`}
      headingAside={<TrainingDisclaimer />}
      backHref={backHref}
      showLogout
    >
      {studentId ? (
        <StudentContextBanner studentId={studentId} label="正在查看训练结果的学生" />
      ) : null}
      <Alert tone="info" data-testid="parent-student-training-result-notice">
        以下为该学生的本次指标与逐题明细，仅供家庭内复盘，不构成诊断或排名。
      </Alert>
      <Alert tone={detail.status === "completed" ? "success" : "info"}>
        <p>
          状态：<span data-testid="session-status">{detail.status}</span>
        </p>
        <p className="mt-1">
          类型：<span data-testid="session-kind">{formatSessionKind(detail.sessionKind)}</span>
        </p>
        <p className="mt-1">
          定义版本：<span data-testid="definition-version">{detail.definitionVersion}</span> ·
          年龄档：
          <span data-testid="age-band"> {formatAgeBand(detail.ageBand)}</span>
        </p>
      </Alert>
      {detail.trialReview ? <TrainingSessionReview trials={detail.trialReview} /> : null}
      <section
        className="rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] p-4"
        data-testid="parent-student-training-metrics"
      >
        <h2 className="mb-3 text-sm font-semibold">本次指标</h2>
        <ul className="flex flex-col gap-2">
          {detail.metrics.map((metric) => (
            <li
              key={metric.metricKey}
              data-testid={`metric-${metric.metricKey}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>{formatMetricLabel(metric.metricKey)}</span>
              <span className="font-medium">{formatMetricValue(metric.value, metric.unit)}</span>
            </li>
          ))}
        </ul>
      </section>
      {studentId ? (
        <TrendsPanel studentId={studentId} trainingKey={detail.trainingKey} testIdPrefix="parent-student-trends" />
      ) : null}
    </PageShell>
  );
}
