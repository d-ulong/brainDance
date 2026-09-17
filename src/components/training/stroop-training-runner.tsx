"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildStroopTrialPlan,
  STROOP_COLOR_LABELS,
  STROOP_COLOR_CLASSES,
  STROOP_SWATCH_CLASSES,
  type StroopDifficulty,
  type StroopTrialPlan,
} from "@/components/training/stroop-trial-plan";
import { TrainingButton } from "@/components/training/training-button";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { createPendingStimulusGate } from "@/components/training/pending-stimulus-gate";
import {
  useTrainingSessionLifecycle,
  type TrainingSessionLifecycleOptions,
} from "@/components/training/use-training-session-lifecycle";
import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import type { StroopColor } from "@/modules/training/constants";
import { STROOP_COLORS } from "@/modules/training/constants";

function inputMethodFromClick(event: { detail: number }): "pointer" | "keyboard" {
  return event.detail === 0 ? "keyboard" : "pointer";
}

export function StroopTrainingRunner({
  lifecycleOptions,
}: {
  lifecycleOptions: TrainingSessionLifecycleOptions;
}) {
  const lifecycle = useTrainingSessionLifecycle("stroop", {
    ...lifecycleOptions,
    deferSessionStart: true,
  });
  const [phase, setPhase] = useState<"intro" | "running">("intro");
  const [difficulty, setDifficulty] = useState<StroopDifficulty>("hard");
  const [trialIndex, setTrialIndex] = useState(0);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [currentTrial, setCurrentTrial] = useState<StroopTrialPlan | null>(null);
  const [trials, setTrials] = useState<StroopTrialPlan[]>([]);
  const stimulusShownAtRef = useRef(0);
  const isInteractionAllowed = lifecycle.isInteractionAllowed;
  const stimulusGateRef = useRef(createPendingStimulusGate(() => isInteractionAllowed()));

  useEffect(() => {
    stimulusGateRef.current = createPendingStimulusGate(() => isInteractionAllowed());
  }, [isInteractionAllowed]);

  const interactionLocked =
    lifecycle.submitting ||
    lifecycle.leaving ||
    lifecycle.paused ||
    lifecycle.terminated ||
    lifecycle.starting ||
    Boolean(lifecycle.error && phase === "running");

  const showStimulus = useCallback(
    async (plan: StroopTrialPlan) => {
      setCurrentTrial(plan);
      setAwaitingResponse(false);
      stimulusGateRef.current.reset();
      try {
        await lifecycle.appendEvent("trial.stimulus", {
          trialIndex: plan.trialIndex,
          inkColor: plan.inkColor,
          wordColor: plan.wordColor,
          taskMode: plan.taskMode,
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

  const beginTraining = useCallback(async () => {
    const started = await lifecycle.beginSession();
    if (!started) return;
    const plan = buildStroopTrialPlan(started.ageBand, difficulty);
    setTrials(plan);
    setTrialIndex(0);
    setPhase("running");
    await showStimulus(plan[0]!);
  }, [difficulty, lifecycle, showStimulus]);

  useEffect(() => {
    if (stimulusGateRef.current.onGateOpen() === "open") {
      stimulusShownAtRef.current = performance.now();
      setAwaitingResponse(true);
    }
  }, [lifecycle.paused, lifecycle.terminated]);

  const prompt = useMemo(() => {
    if (!currentTrial) return "";
    return currentTrial.taskMode === "name_word"
      ? "请选择字义表示的颜色（忽略墨色）"
      : "请选择墨水颜色（忽略文字含义）";
  }, [currentTrial]);

  if (lifecycle.loading) {
    return (
      <PageShell title="Stroop 抑制">
        <LoadingState label="准备训练…" />
      </PageShell>
    );
  }

  if (lifecycle.error && phase === "intro" && !lifecycle.session) {
    return (
      <PageShell title="Stroop 抑制" backHref={lifecycle.hubPath}>
        <Alert tone="error">{lifecycle.error}</Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Stroop 抑制"
      subtitle={
        phase === "intro"
          ? "说明与难度"
          : `第 ${Math.min(trialIndex + 1, trials.length || 1)} / ${trials.length || "—"} 次`
      }
      subtitleKind="status"
      backHref={lifecycle.hubPath}
      showLogout
      onBeforeNavigate={lifecycle.confirmLeave}
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
      {lifecycle.error && phase === "running" ? <Alert tone="error">{lifecycle.error}</Alert> : null}

      {phase === "intro" ? (
        <section className="space-y-4 rounded-3xl border border-[var(--bd-border)] bg-white p-5" data-testid="stroop-intro">
          <p className="text-sm text-slate-700">
            Stroop 抑制训练会在字义和墨色之间制造冲突。请先阅读规则，再选择难度后开始。
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              <strong>看墨色</strong>：报告墨水颜色，忽略字义。墨色与字义始终不同。
            </li>
            <li>
              <strong>看字义</strong>：字用随机颜色显示，报告字所表示的颜色（忽略墨色）。
            </li>
            <li>
              <strong>困难</strong>：以上两种规则会随机穿插出题，每题上方会提示当前规则。
            </li>
          </ul>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-800">难度</legend>
            {(
              [
                ["hard", "困难 · 两种规则随机混合（16 题）"],
                ["easy_ink", "简单 · 看墨色忽略字义（16 题）"],
                ["easy_word", "简单 · 看字义（随机颜色字，16 题）"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="stroop-difficulty"
                  checked={difficulty === value}
                  onChange={() => setDifficulty(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <PrimaryButton
            data-testid="stroop-start"
            disabled={lifecycle.starting}
            onClick={() => void beginTraining()}
          >
            {lifecycle.starting ? "正在开始…" : "开始"}
          </PrimaryButton>
        </section>
      ) : (
        <>
          {currentTrial ? (
            <div
              className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-neutral-300 bg-white p-4"
              data-testid="stroop-stimulus"
              data-ink-color={currentTrial.inkColor}
              data-word-color={currentTrial.wordColor}
              data-task-mode={currentTrial.taskMode}
            >
              <p className="text-xs text-neutral-500">{prompt}</p>
              <p className={`mt-2 text-4xl font-bold ${STROOP_COLOR_CLASSES[currentTrial.inkColor]}`}>
                {STROOP_COLOR_LABELS[currentTrial.wordColor]}
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
          <p className="text-xs text-neutral-500">点击颜色按钮作答。</p>
          {lifecycle.submitting ? <LoadingState label="正在提交训练结果…" /> : null}
        </>
      )}
    </PageShell>
  );
}
