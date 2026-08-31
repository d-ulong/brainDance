"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildStroopTrialPlan,
  STROOP_COLOR_LABELS,
  STROOP_COLOR_CLASSES,
  STROOP_SWATCH_CLASSES,
  type StroopTrialPlan,
} from "@/components/training/stroop-trial-plan";
import { TrainingButton } from "@/components/training/training-button";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { useTrainingSessionLifecycle } from "@/components/training/use-training-session-lifecycle";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";
import type { StroopColor } from "@/modules/training/constants";
import { STROOP_COLORS } from "@/modules/training/constants";

function inputMethodFromClick(event: { detail: number }): "pointer" | "keyboard" {
  return event.detail === 0 ? "keyboard" : "pointer";
}

export default function StroopTrainingPage() {
  const lifecycle = useTrainingSessionLifecycle("stroop");
  const [trialIndex, setTrialIndex] = useState(0);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [currentTrial, setCurrentTrial] = useState<StroopTrialPlan | null>(null);
  const stimulusShownAtRef = useRef(0);
  const initializedRef = useRef(false);

  const trials = useMemo(
    () => (lifecycle.session ? buildStroopTrialPlan(lifecycle.session.ageBand) : []),
    [lifecycle.session],
  );

  const interactionLocked =
    lifecycle.submitting || lifecycle.paused || lifecycle.terminated || Boolean(lifecycle.error);

  const showStimulus = useCallback(
    async (plan: StroopTrialPlan) => {
      setCurrentTrial(plan);
      setAwaitingResponse(false);
      try {
        await lifecycle.appendEvent("trial.stimulus", {
          trialIndex: plan.trialIndex,
          inkColor: plan.inkColor,
          wordColor: plan.wordColor,
        });
        stimulusShownAtRef.current = performance.now();
        setAwaitingResponse(true);
      } catch {
        setAwaitingResponse(false);
      }
    },
    [lifecycle],
  );

  const respond = useCallback(
    async (selectedColor: StroopColor, inputMethod: "pointer" | "keyboard") => {
      if (!lifecycle.session || !awaitingResponse || !currentTrial || interactionLocked) {
        return;
      }

      const elapsed = performance.now() - stimulusShownAtRef.current;
      if (elapsed < 150) return;

      setAwaitingResponse(false);

      try {
        await lifecycle.appendEvent("trial.response", {
          trialIndex: currentTrial.trialIndex,
          selectedColor,
          inputMethod,
        });

        const nextIndex = trialIndex + 1;
        if (nextIndex >= trials.length) {
          await lifecycle.submitSession();
          return;
        }

        setTrialIndex(nextIndex);
        await showStimulus(trials[nextIndex]!);
      } catch {
        setAwaitingResponse(true);
      }
    },
    [
      awaitingResponse,
      currentTrial,
      interactionLocked,
      lifecycle,
      showStimulus,
      trialIndex,
      trials,
    ],
  );

  useEffect(() => {
    if (
      !lifecycle.session ||
      initializedRef.current ||
      trials.length === 0 ||
      lifecycle.terminated
    ) {
      return;
    }
    initializedRef.current = true;
    void showStimulus(trials[0]!);
  }, [lifecycle.session, lifecycle.terminated, showStimulus, trials]);

  if (lifecycle.loading) {
    return (
      <PageShell title="Stroop 抑制">
        <LoadingState label="准备训练…" />
      </PageShell>
    );
  }

  if (lifecycle.error) {
    return (
      <PageShell title="Stroop 抑制" backHref="/student/training">
        <Alert tone="error">{lifecycle.error}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Stroop 抑制"
      subtitle={`第 ${Math.min(trialIndex + 1, trials.length)} / ${trials.length} 次`}
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

      {currentTrial ? (
        <div
          className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-neutral-300 bg-white p-4"
          data-testid="stroop-stimulus"
          data-ink-color={currentTrial.inkColor}
        >
          <p className="text-xs text-neutral-500">请选择墨水颜色（忽略文字含义）</p>
          <p className={`mt-2 text-4xl font-bold ${STROOP_COLOR_CLASSES[currentTrial.inkColor]}`}>
            {STROOP_COLOR_LABELS[currentTrial.wordColor]}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            文字含义：{STROOP_COLOR_LABELS[currentTrial.wordColor]} · 一致=
            {currentTrial.congruent ? "是" : "否"}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3" role="group" aria-label="颜色选项">
        {STROOP_COLORS.map((color) => (
          <TrainingButton
            key={color}
            variant="option"
            data-testid={`stroop-option-${color}`}
            disabled={!awaitingResponse || interactionLocked}
            onClick={(event) => void respond(color, inputMethodFromClick(event))}
            className="flex min-h-11 items-center justify-center gap-2"
          >
            <span
              className={`inline-block h-4 w-4 rounded-full ${STROOP_SWATCH_CLASSES[color]}`}
              aria-hidden
            />
            <span>{STROOP_COLOR_LABELS[color]}</span>
          </TrainingButton>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        点击颜色按钮，或将焦点移到选项后按 Space / Enter 确认选择。
      </p>
      {lifecycle.submitting ? <LoadingState label="正在提交训练结果…" /> : null}
    </PageShell>
  );
}
