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
import { TrendsPanel } from "@/components/training/trends-panel";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, fetchSession } from "@/lib/client/api";
import { fetchTrainingSession, type TrainingSessionDetail } from "@/lib/client/training-api";

export default function ParentTrainingResultPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrainingSessionDetail | null>(null);

  const loadSession = useCallback(async (id: string) => {
    const data = await fetchTrainingSession(id);
    setDetail(data);
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
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
        await loadSession(resolved.sessionId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "无法加载训练结果");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSession, params, router]);

  if (loading) {
    return (
      <PageShell title="家长训练结果">
        <LoadingState />
      </PageShell>
    );
  }

  if (error || !detail) {
    return (
      <PageShell title="家长训练结果" backHref="/parent/training">
        <Alert tone="error">{error ?? "未找到训练结果"}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="家长训练结果"
      subtitle={`${formatTrainingKeyLabel(detail.trainingKey)} · 会话 ${sessionId?.slice(0, 8)}…`}
      backHref="/parent/training"
      showLogout
    >
      <TrainingDisclaimer />
      <Alert tone="info" data-testid="parent-training-result-notice">
        以下为您本人的本次指标与个人趋势，仅供个人练习复盘，不构成诊断或排名。
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
          <span data-testid="age-band" data-age-band={detail.ageBand}>
            {" "}
            {formatAgeBand(detail.ageBand)}
          </span>
        </p>
      </Alert>
      <section
        className="rounded-xl border border-neutral-300 bg-white p-4"
        data-testid="parent-training-metrics"
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
      <TrendsPanel
        mode="self"
        trainingKey={detail.trainingKey}
        testIdPrefix="parent-training-trends"
      />
    </PageShell>
  );
}
