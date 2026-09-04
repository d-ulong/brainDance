"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TrainingButton } from "@/components/training/training-button";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { createPendingStimulusGate } from "@/components/training/pending-stimulus-gate";
import {
  useTrainingSessionLifecycle,
  useKeyboardAction,
  type TrainingSessionLifecycleOptions,
} from "@/components/training/use-training-session-lifecycle";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import { REACTION_MIN_VALID_MS } from "@/modules/training/constants";

function inputMethodFromClick(event: { detail: number }): "pointer" | "keyboard" {
  return event.detail === 0 ? "keyboard" : "pointer";
}

export function ReactionTrainingRunner({
  lifecycleOptions,
}: {
  lifecycleOptions: TrainingSessionLifecycleOptions;
}) {
  const lifecycle = useTrainingSessionLifecycle("reaction", lifecycleOptions);
  const [trialIndex, setTrialIndex] = useState(0);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const stimulusShownAtRef = useRef(0);
  const initializedRef = useRef(false);
  const isInteractionAllowed = lifecycle.isInteractionAllowed;
  const stimulusGateRef = useRef(createPendingStimulusGate(() => isInteractionAllowed()));

  useEffect(() => {
    stimulusGateRef.current = createPendingStimulusGate(() => isInteractionAllowed());
  }, [isInteractionAllowed]);

  const expectedTrials = lifecycle.session?.expectedTrialCount ?? 5;

  const interactionLocked =
    lifecycle.submitting || lifecycle.paused || lifecycle.terminated || Boolean(lifecycle.error);

  const showStimulus = useCallback(
    async (index: number) => {
      if (!lifecycle.session) return;
      setAwaitingResponse(false);
      stimulusGateRef.current.reset();
      try {
        await lifecycle.appendEvent("trial.stimulus", {
          trialIndex: index,
          stimulusId: `s-${index}`,
        });
        if (stimulusGateRef.current.afterAppendSuccess() === "open") {
          stimulusShownAtRef.current = performance.now();
          setAwaitingResponse(true);
        }
      } catch {
        setAwaitingResponse(false);
        stimulusGateRef.current.reset();
      }
    },
    [lifecycle],
  );

  const respond = useCallback(
    async (inputMethod: "pointer" | "keyboard") => {
      if (!lifecycle.session || !awaitingResponse || interactionLocked) return;

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
          inputMethod,
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
    },
    [awaitingResponse, expectedTrials, interactionLocked, lifecycle, showStimulus, trialIndex],
  );

  useKeyboardAction(() => void respond("keyboard"), awaitingResponse && !interactionLocked);

  useEffect(() => {
    if (!lifecycle.session || initializedRef.current || lifecycle.terminated) return;
    initializedRef.current = true;
    void showStimulus(0);
  }, [lifecycle.session, lifecycle.terminated, showStimulus]);

  useEffect(() => {
    if (stimulusGateRef.current.onGateOpen() === "open") {
      stimulusShownAtRef.current = performance.now();
      setAwaitingResponse(true);
    }
  }, [lifecycle.paused, lifecycle.terminated]);

  if (lifecycle.loading) {
    return (
      <PageShell title="反应力训练">
        <LoadingState label="准备训练…" />
      </PageShell>
    );
  }

  if (lifecycle.error) {
    return (
      <PageShell title="反应力训练" backHref={lifecycle.hubPath}>
        <Alert tone="error">{lifecycle.error}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="反应力训练"
      subtitle={`第 ${Math.min(trialIndex + 1, expectedTrials)} / ${expectedTrials} 次`}
      backHref={lifecycle.hubPath}
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
        disabled={!awaitingResponse || interactionLocked}
        onClick={(event) => void respond(inputMethodFromClick(event))}
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
