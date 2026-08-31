"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TrainingButton } from "@/components/training/training-button";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import {
  useKeyboardAction,
  useTrainingSessionLifecycle,
} from "@/components/training/use-training-session-lifecycle";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { REACTION_MIN_VALID_MS } from "@/modules/training/constants";

export default function ReactionTrainingPage() {
  const lifecycle = useTrainingSessionLifecycle("reaction");
  const [trialIndex, setTrialIndex] = useState(0);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const stimulusShownAtRef = useRef(0);
  const initializedRef = useRef(false);

  const expectedTrials = lifecycle.session?.expectedTrialCount ?? 5;

  const showStimulus = useCallback(
    async (index: number) => {
      if (!lifecycle.session) return;
      setAwaitingResponse(true);
      stimulusShownAtRef.current = performance.now();
      await lifecycle.appendEvent("trial.stimulus", {
        trialIndex: index,
        stimulusId: `s-${index}`,
      });
    },
    [lifecycle],
  );

  const respond = useCallback(async () => {
    if (!lifecycle.session || !awaitingResponse || lifecycle.submitting || lifecycle.paused) return;

    const elapsed = performance.now() - stimulusShownAtRef.current;
    if (elapsed < REACTION_MIN_VALID_MS) {
      return;
    }

    setAwaitingResponse(false);
    const currentTrial = trialIndex;

    try {
      await lifecycle.appendEvent("trial.response", {
        trialIndex: currentTrial,
        correct: true,
        inputMethod: "keyboard",
      });

      const nextTrial = currentTrial + 1;
      if (nextTrial >= expectedTrials) {
        await lifecycle.submitSession();
        return;
      }

      setTrialIndex(nextTrial);
      await showStimulus(nextTrial);
    } catch {
      setAwaitingResponse(true);
    }
  }, [awaitingResponse, expectedTrials, lifecycle, showStimulus, trialIndex]);

  useKeyboardAction(
    () => void respond(),
    awaitingResponse && !lifecycle.paused && !lifecycle.submitting,
  );

  useEffect(() => {
    if (!lifecycle.session || initializedRef.current) return;
    initializedRef.current = true;
    void showStimulus(0);
  }, [lifecycle.session, showStimulus]);

  if (lifecycle.loading) {
    return (
      <PageShell title="反应力训练">
        <LoadingState label="准备训练…" />
      </PageShell>
    );
  }

  if (lifecycle.error) {
    return (
      <PageShell title="反应力训练" backHref="/student/training">
        <Alert tone="error">{lifecycle.error}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="反应力训练"
      subtitle={`第 ${Math.min(trialIndex + 1, expectedTrials)} / ${expectedTrials} 次`}
      backHref="/student/training"
      showLogout
    >
      <TrainingDisclaimer />
      {lifecycle.paused ? (
        <Alert tone="info" data-testid="training-paused">
          页面失焦，训练已暂停。回到本页后继续。
        </Alert>
      ) : null}
      {lifecycle.pendingRetry ? (
        <Alert tone="info" data-testid="training-retry">
          网络不稳定，正在重试提交…
        </Alert>
      ) : null}
      <TrainingButton
        data-testid="training-target"
        disabled={!awaitingResponse || lifecycle.submitting || lifecycle.paused}
        onClick={() => void respond()}
        className="flex min-h-[200px] w-full flex-col items-center justify-center border-2 border-dashed border-neutral-400 bg-white text-neutral-900 hover:bg-white"
      >
        {awaitingResponse ? (
          <>
            <span className="text-4xl font-bold">+</span>
            <span className="mt-3 text-sm text-neutral-600">点击或按 Space / Enter 响应</span>
          </>
        ) : lifecycle.submitting ? (
          <span className="text-sm text-neutral-600">提交结果中…</span>
        ) : (
          <span className="text-sm text-neutral-600">准备下一次…</span>
        )}
      </TrainingButton>
      {lifecycle.submitting ? <LoadingState label="正在提交训练结果…" /> : null}
    </PageShell>
  );
}
