"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession } from "@/lib/client/api";

type SessionDetail = {
  sessionId: string;
  status: string;
  sessionKind: string | null;
  metrics: Array<{ metricKey: string; value: number; unit: string | null }>;
};

export default function TrainingResultPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  const loadSession = useCallback(async (id: string) => {
    const data = await apiFetch<SessionDetail>(`/api/training/sessions/${id}`);
    setDetail(data);
  }, []);

  useEffect(() => {
    void (async () => {
      const resolved = await params;
      setSessionId(resolved.sessionId);

      const session = await fetchSession();
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      if (session.mustChangePassword) {
        router.replace("/student/change-password");
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
      <PageShell title="训练结果">
        <LoadingState />
      </PageShell>
    );
  }

  if (error || !detail) {
    return (
      <PageShell title="训练结果" backHref="/">
        <Alert tone="error">{error ?? "未找到训练结果"}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="训练结果"
      subtitle={`会话 ${sessionId?.slice(0, 8)}…`}
      backHref="/"
      showLogout
    >
      <Alert tone="success">
        <p>
          状态：<span data-testid="session-status">{detail.status}</span>
          {detail.sessionKind ? `（${detail.sessionKind}）` : null}
        </p>
      </Alert>
      <section className="rounded-xl border border-neutral-300 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">指标</h2>
        <ul className="flex flex-col gap-2">
          {detail.metrics.map((metric) => (
            <li
              key={metric.metricKey}
              data-testid={`metric-${metric.metricKey}`}
              className="flex items-center justify-between text-sm"
            >
              <span>{metric.metricKey}</span>
              <span className="font-medium">
                {metric.value}
                {metric.unit ? ` ${metric.unit}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
