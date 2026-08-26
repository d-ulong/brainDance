"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { ApiError, apiFetch, fetchSession, newIdempotencyKey } from "@/lib/client/api";

type StartResult = {
  sessionId: string;
  expectedTrialCount: number;
};

export default function ReactionTrainingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expectedTrials, setExpectedTrials] = useState(5);
  const [trialIndex, setTrialIndex] = useState(0);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const sequenceRef = useRef(0);
  const stimulusShownAtRef = useRef<number>(0);
  const startedRef = useRef(false);

  const appendEvent = useCallback(
    async (sid: string, eventType: string, payload: Record<string, unknown>) => {
      await apiFetch(`/api/training/sessions/${sid}/events`, {
        method: "POST",
        body: JSON.stringify({
          sequence: sequenceRef.current,
          eventType,
          payload,
        }),
      });
      sequenceRef.current += 1;
    },
    [],
  );

  const showStimulus = useCallback(
    async (sid: string, index: number) => {
      setAwaitingResponse(true);
      stimulusShownAtRef.current = Date.now();
      await appendEvent(sid, "trial.stimulus", { trialIndex: index, stimulusId: `s-${index}` });
    },
    [appendEvent],
  );

  const respond = useCallback(async () => {
    if (!sessionId || !awaitingResponse || submitting) return;

    const elapsed = Date.now() - stimulusShownAtRef.current;
    if (elapsed < 120) {
      return;
    }

    setAwaitingResponse(false);
    const currentTrial = trialIndex;

    try {
      await appendEvent(sessionId, "trial.response", {
        trialIndex: currentTrial,
        correct: true,
        inputMethod: "keyboard",
      });

      const nextTrial = currentTrial + 1;
      if (nextTrial >= expectedTrials) {
        setSubmitting(true);
        await apiFetch(`/api/training/sessions/${sessionId}/submit`, {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: newIdempotencyKey("submit-training") }),
        });
        router.push(`/student/training/${sessionId}`);
        return;
      }

      setTrialIndex(nextTrial);
      await showStimulus(sessionId, nextTrial);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "训练记录失败");
      setSubmitting(false);
    }
  }, [
    appendEvent,
    awaitingResponse,
    expectedTrials,
    router,
    sessionId,
    showStimulus,
    submitting,
    trialIndex,
  ]);

  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      if (!session || session.role !== "student") {
        router.replace("/login");
        return;
      }
      if (session.mustChangePassword) {
        router.replace("/student/change-password");
        return;
      }

      if (startedRef.current) {
        setLoading(false);
        return;
      }
      startedRef.current = true;

      try {
        const started = await apiFetch<StartResult>("/api/training/sessions", {
          method: "POST",
          body: JSON.stringify({
            trainingKey: "reaction",
            idempotencyKey: newIdempotencyKey("start-training"),
          }),
        });
        setSessionId(started.sessionId);
        setExpectedTrials(started.expectedTrialCount);
        sequenceRef.current = 0;
        setTrialIndex(0);
        await showStimulus(started.sessionId, 0);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "无法开始训练");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, showStimulus]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        void respond();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [respond]);

  if (loading) {
    return (
      <PageShell title="反应力训练">
        <LoadingState label="准备训练…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="反应力训练" backHref="/">
        <Alert tone="error">{error}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="反应力训练"
      subtitle={`第 ${Math.min(trialIndex + 1, expectedTrials)} / ${expectedTrials} 次`}
      backHref="/"
      showLogout
    >
      <button
        type="button"
        data-testid="training-target"
        disabled={!awaitingResponse || submitting}
        onClick={() => void respond()}
        className="flex min-h-[200px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-400 bg-white px-4 py-8 text-center disabled:opacity-60"
      >
        {awaitingResponse ? (
          <>
            <span className="text-4xl font-bold text-neutral-900">+</span>
            <span className="mt-3 text-sm text-neutral-600">点击或按 Space / Enter 响应</span>
          </>
        ) : submitting ? (
          <span className="text-sm text-neutral-600">提交结果中…</span>
        ) : (
          <span className="text-sm text-neutral-600">准备下一次…</span>
        )}
      </button>
      {submitting ? <LoadingState label="正在提交训练结果…" /> : null}
    </PageShell>
  );
}
