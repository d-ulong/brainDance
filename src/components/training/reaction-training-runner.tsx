"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { createPendingStimulusGate } from "@/components/training/pending-stimulus-gate";
import {
  TrainingTrialProgress,
  type TrialOutcome,
} from "@/components/training/training-trial-progress";
import {
  useTrainingSessionLifecycle,
  useKeyboardAction,
  type TrainingSessionLifecycleOptions,
} from "@/components/training/use-training-session-lifecycle";
import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";
import { DEFAULT_REACTION_TRIAL_COUNT, REACTION_MIN_VALID_MS } from "@/modules/training/constants";

type Phase = "intro" | "waiting" | "go" | "feedback";

function inputMethodFromClick(event: { detail: number }): "pointer" | "keyboard" {
  return event.detail === 0 ? "keyboard" : "pointer";
}

function randomWaitMs() {
  return 800 + Math.floor(Math.random() * 1700);
}

/** Waiting = blue; go = green. Inline styles beat theme `.bd-primary` / Tailwind. */
const WAIT_STYLE = {
  backgroundColor: "#2563eb",
  borderColor: "#1d4ed8",
  color: "#ffffff",
} as const;

const GO_STYLE = {
  backgroundColor: "#16a34a",
  borderColor: "#15803d",
  color: "#ffffff",
} as const;

const FEEDBACK_BAD_STYLE = {
  backgroundColor: "#ffe4e6",
  borderColor: "#fb7185",
  color: "#9f1239",
} as const;

const FEEDBACK_OK_STYLE = {
  backgroundColor: "#ecfdf5",
  borderColor: "#6ee7b7",
  color: "#065f46",
} as const;

export function ReactionTrainingRunner({
  lifecycleOptions,
}: {
  lifecycleOptions: TrainingSessionLifecycleOptions;
}) {
  const lifecycle = useTrainingSessionLifecycle("reaction", {
    ...lifecycleOptions,
    deferSessionStart: true,
  });
  const [phase, setPhase] = useState<Phase>("intro");
  const [trialIndex, setTrialIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<TrialOutcome[]>([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"ok" | "bad">("ok");
  const stimulusShownAtRef = useRef(0);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trialIndexRef = useRef(0);
  const phaseRef = useRef<Phase>("intro");
  const expectedTrialsRef = useRef(DEFAULT_REACTION_TRIAL_COUNT);
  const presentStimulusRef = useRef<(index: number) => void>(() => undefined);
  const scheduleWaitRef = useRef<(index: number) => void>(() => undefined);
  const afterTrialRef = useRef<(nextIndex: number) => Promise<void>>(async () => undefined);
  const recordOutcomeRef = useRef<(index: number, outcome: Exclude<TrialOutcome, null>) => void>(
    () => undefined,
  );
  const isInteractionAllowed = lifecycle.isInteractionAllowed;
  const stimulusGateRef = useRef(createPendingStimulusGate(() => isInteractionAllowed()));

  phaseRef.current = phase;
  trialIndexRef.current = trialIndex;

  const recordOutcome = useCallback((index: number, outcome: Exclude<TrialOutcome, null>) => {
    setOutcomes((prev) => {
      const next = [...prev];
      next[index] = outcome;
      return next;
    });
  }, []);
  recordOutcomeRef.current = recordOutcome;

  useEffect(() => {
    stimulusGateRef.current = createPendingStimulusGate(() => isInteractionAllowed());
  }, [isInteractionAllowed]);

  const expectedTrials = lifecycle.session?.expectedTrialCount ?? DEFAULT_REACTION_TRIAL_COUNT;
  expectedTrialsRef.current = expectedTrials;

  const interactionLocked =
    lifecycle.submitting ||
    lifecycle.leaving ||
    lifecycle.paused ||
    lifecycle.terminated ||
    lifecycle.starting ||
    Boolean(lifecycle.error && phase !== "intro");

  const clearTimers = useCallback(() => {
    if (waitTimerRef.current !== null) {
      clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const showFeedback = useCallback((text: string, tone: "ok" | "bad", delayMs: number, next: () => void) => {
    setFeedbackText(text);
    setFeedbackTone(tone);
    setPhase("feedback");
    phaseRef.current = "feedback";
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      next();
    }, delayMs);
  }, []);

  const afterTrial = useCallback(
    async (nextIndex: number) => {
      if (nextIndex >= expectedTrialsRef.current) {
        await lifecycle.submitSession();
        return;
      }
      setTrialIndex(nextIndex);
      trialIndexRef.current = nextIndex;
      scheduleWaitRef.current(nextIndex);
    },
    [lifecycle],
  );
  afterTrialRef.current = afterTrial;

  const armGoTimeout = useCallback(
    (index: number) => {
      if (timeoutTimerRef.current !== null) {
        clearTimeout(timeoutTimerRef.current);
      }
      timeoutTimerRef.current = setTimeout(() => {
        void (async () => {
          if (phaseRef.current !== "go") return;
          clearTimers();
          try {
            await lifecycle.appendEvent("trial.response", {
              trialIndex: index,
              correct: false,
              inputMethod: "pointer",
              timedOut: true,
            });
            recordOutcomeRef.current(index, "incorrect");
            showFeedback("太慢（>1000ms）", "bad", 600, () => {
              void afterTrialRef.current(index + 1);
            });
          } catch {
            setPhase("go");
            phaseRef.current = "go";
          }
        })();
      }, 1000);
    },
    [clearTimers, lifecycle, showFeedback],
  );

  const presentStimulus = useCallback(
    (index: number) => {
      // Flip to green immediately when the random wait ends — never block on network.
      // appendEvent is queued; responses enqueue after stimulus and keep order.
      stimulusGateRef.current.reset();
      stimulusShownAtRef.current = performance.now();
      setPhase("go");
      phaseRef.current = "go";
      armGoTimeout(index);

      void (async () => {
        try {
          await lifecycle.appendEvent("trial.stimulus", {
            trialIndex: index,
            stimulusId: `s-${index}`,
          });
          if (stimulusGateRef.current.afterAppendSuccess() !== "open") {
            // Paused mid-flight: keep deferred so unpause can re-arm timeout clock.
            if (timeoutTimerRef.current !== null) {
              clearTimeout(timeoutTimerRef.current);
              timeoutTimerRef.current = null;
            }
          }
        } catch (cause) {
          console.error("reaction stimulus failed", cause);
          // Keep showing go; retry append so the response queue still has a stimulus.
          waitTimerRef.current = setTimeout(() => {
            void lifecycle
              .appendEvent("trial.stimulus", {
                trialIndex: index,
                stimulusId: `s-${index}`,
              })
              .catch((retryCause) => console.error("reaction stimulus retry failed", retryCause));
          }, 400);
        }
      })();
    },
    [armGoTimeout, lifecycle],
  );
  presentStimulusRef.current = presentStimulus;

  const scheduleWait = useCallback(
    (index: number) => {
      clearTimers();
      setPhase("waiting");
      phaseRef.current = "waiting";
      waitTimerRef.current = setTimeout(() => {
        waitTimerRef.current = null;
        presentStimulusRef.current(index);
      }, randomWaitMs());
    },
    [clearTimers],
  );
  scheduleWaitRef.current = scheduleWait;

  const beginTraining = useCallback(async () => {
    const started = await lifecycle.beginSession();
    if (!started) return;
    expectedTrialsRef.current = started.expectedTrialCount || DEFAULT_REACTION_TRIAL_COUNT;
    setOutcomes(Array.from({ length: expectedTrialsRef.current }, () => null));
    setTrialIndex(0);
    trialIndexRef.current = 0;
    scheduleWaitRef.current(0);
  }, [lifecycle]);

  const respond = useCallback(
    async (inputMethod: "pointer" | "keyboard") => {
      if (interactionLocked) return;

      if (phaseRef.current === "waiting") {
        clearTimers();
        showFeedback("太早了！", "bad", 700, () => {
          scheduleWaitRef.current(trialIndexRef.current);
        });
        return;
      }

      if (phaseRef.current !== "go") return;

      const elapsed = performance.now() - stimulusShownAtRef.current;
      clearTimers();
      const currentTrial = trialIndexRef.current;

      if (elapsed < REACTION_MIN_VALID_MS) {
        try {
          await lifecycle.appendEvent("trial.response", {
            trialIndex: currentTrial,
            correct: false,
            inputMethod,
            early: true,
          });
          recordOutcomeRef.current(currentTrial, "incorrect");
          showFeedback("太早了！", "bad", 700, () => {
            void afterTrialRef.current(currentTrial + 1);
          });
        } catch {
          setPhase("go");
          phaseRef.current = "go";
        }
        return;
      }

      try {
        await lifecycle.appendEvent("trial.response", {
          trialIndex: currentTrial,
          correct: true,
          inputMethod,
        });
        recordOutcomeRef.current(currentTrial, "correct");
        showFeedback(`${Math.round(elapsed)} ms`, "ok", 480, () => {
          void afterTrialRef.current(currentTrial + 1);
        });
      } catch {
        setPhase("go");
        phaseRef.current = "go";
      }
    },
    [clearTimers, interactionLocked, lifecycle, showFeedback],
  );

  useKeyboardAction(
    () => void respond("keyboard"),
    (phase === "waiting" || phase === "go") && !interactionLocked,
  );

  useEffect(() => {
    if (lifecycle.paused) {
      clearTimers();
    }
  }, [clearTimers, lifecycle.paused]);

  // Resume deferred go after blur/pause clears.
  useEffect(() => {
    if (lifecycle.paused || lifecycle.terminated) return;
    if (stimulusGateRef.current.onGateOpen() !== "open") return;
    if (phaseRef.current !== "go") return;
    stimulusShownAtRef.current = performance.now();
    armGoTimeout(trialIndexRef.current);
  }, [armGoTimeout, lifecycle.paused, lifecycle.terminated]);

  if (lifecycle.loading) {
    return (
      <PageShell title="反应力训练">
        <LoadingState label="准备训练…" />
      </PageShell>
    );
  }

  if (lifecycle.error && phase === "intro" && !lifecycle.session) {
    return (
      <PageShell title="反应力训练" backHref={lifecycle.hubPath}>
        <Alert tone="error">{lifecycle.error}</Alert>
      </PageShell>
    );
  }

  const targetStyle =
    phase === "go"
      ? GO_STYLE
      : phase === "feedback" && feedbackTone === "bad"
        ? FEEDBACK_BAD_STYLE
        : phase === "feedback"
          ? FEEDBACK_OK_STYLE
          : WAIT_STYLE;

  return (
    <PageShell
      title="反应力训练"
      subtitle={phase === "intro" ? "说明" : undefined}
      subtitleKind={phase === "intro" ? "status" : "help"}
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
      {lifecycle.error && phase !== "intro" ? <Alert tone="error">{lifecycle.error}</Alert> : null}

      {phase === "intro" ? (
        <section
          className="space-y-4 rounded-3xl border border-[var(--bd-border)] bg-white p-5"
          data-testid="reaction-intro"
        >
          <p className="text-sm text-slate-700">
            蓝色「准备…」时不要点；变成<strong>绿色「点!」</strong>后，尽快点击屏幕或按 Space / Enter。抢点会提示太早并重来。
          </p>
          <p className="text-sm text-slate-600">
            每轮等待时间随机（约 0.8–2.5 秒）；超过 1 秒未反应记为太慢。本局共 {DEFAULT_REACTION_TRIAL_COUNT}{" "}
            次，成绩取有效反应的中位数。
          </p>
          <PrimaryButton
            data-testid="reaction-start"
            disabled={lifecycle.starting}
            onClick={() => void beginTraining()}
          >
            {lifecycle.starting ? "正在开始…" : "开始"}
          </PrimaryButton>
        </section>
      ) : (
        <>
          <TrainingTrialProgress
            total={expectedTrials}
            currentIndex={trialIndex}
            outcomes={outcomes}
          />
          <button
            type="button"
            data-testid="training-target"
            data-phase={phase}
            disabled={interactionLocked || phase === "feedback" || lifecycle.submitting}
            onClick={(event) => void respond(inputMethodFromClick(event))}
            className="flex min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border-4 text-lg font-bold disabled:cursor-not-allowed disabled:opacity-60"
            style={targetStyle}
          >
            {phase === "waiting" ? (
              <span className="text-2xl font-bold">准备…</span>
            ) : phase === "go" ? (
              <>
                <span className="text-5xl font-black tracking-wide">点!</span>
                <span className="mt-3 text-sm font-semibold">点击或按 Space / Enter</span>
              </>
            ) : phase === "feedback" ? (
              <span className="text-2xl font-bold">{feedbackText}</span>
            ) : (
              <span className="text-sm">提交结果中…</span>
            )}
          </button>
        </>
      )}
      {lifecycle.submitting ? <LoadingState label="正在提交训练结果…" /> : null}
    </PageShell>
  );
}
