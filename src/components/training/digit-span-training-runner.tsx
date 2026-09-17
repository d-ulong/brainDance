"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildDigitSpanAttemptPlan,
  SEQUENTIAL_DIGIT_MS,
  wholeSequenceDisplayMs,
  type DigitSpanAttemptPlan,
  type DigitSpanDifficulty,
} from "@/components/training/digit-span-plan";
import {
  displayActionAfterAppend,
  shouldAdvanceDisplayOnTimer,
} from "@/components/training/pending-stimulus-gate";
import { TrainingButton } from "@/components/training/training-button";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import {
  useTrainingSessionLifecycle,
  type TrainingSessionLifecycleOptions,
} from "@/components/training/use-training-session-lifecycle";
import { Alert, LoadingState, PageShell, PrimaryButton } from "@/components/ui/page-shell";

type Phase = "intro" | "stimulus" | "response";

export function DigitSpanTrainingRunner({
  lifecycleOptions,
}: {
  lifecycleOptions: TrainingSessionLifecycleOptions;
}) {
  const lifecycle = useTrainingSessionLifecycle("digit-span", {
    ...lifecycleOptions,
    deferSessionStart: true,
  });
  const [uiPhase, setUiPhase] = useState<Phase>("intro");
  const [difficulty, setDifficulty] = useState<DigitSpanDifficulty>("hard");
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [phase, setPhase] = useState<"stimulus" | "response">("stimulus");
  const [currentAttempt, setCurrentAttempt] = useState<DigitSpanAttemptPlan | null>(null);
  const [attempts, setAttempts] = useState<DigitSpanAttemptPlan[]>([]);
  const [responseDigits, setResponseDigits] = useState<number[]>([]);
  const [visibleDigit, setVisibleDigit] = useState<string>("");
  const [sequential, setSequential] = useState(false);
  const phaseRef = useRef<"stimulus" | "response">("stimulus");
  const currentAttemptRef = useRef<DigitSpanAttemptPlan | null>(null);
  const responseDigitsRef = useRef<number[]>([]);
  const displayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const digitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayRemainingRef = useRef(0);
  const displayStartedAtRef = useRef<number | null>(null);
  const resumeFromDisplayExpiryRef = useRef(false);
  const prevPausedRef = useRef(false);

  phaseRef.current = phase;
  currentAttemptRef.current = currentAttempt;
  responseDigitsRef.current = responseDigits;

  const interactionLocked =
    lifecycle.submitting ||
    lifecycle.leaving ||
    lifecycle.paused ||
    lifecycle.terminated ||
    lifecycle.starting ||
    Boolean(lifecycle.error && uiPhase !== "intro");

  const clearDisplayTimer = useCallback(() => {
    if (displayTimerRef.current !== null) {
      clearTimeout(displayTimerRef.current);
      displayTimerRef.current = null;
    }
    if (digitTimerRef.current !== null) {
      clearInterval(digitTimerRef.current);
      digitTimerRef.current = null;
    }
  }, []);

  const openResponsePhase = useCallback(() => {
    setVisibleDigit("");
    setPhase("response");
    displayRemainingRef.current = 0;
    displayStartedAtRef.current = null;
    resumeFromDisplayExpiryRef.current = false;
  }, []);

  const isInteractionAllowed = lifecycle.isInteractionAllowed;

  const scheduleDisplayEnd = useCallback(
    (remainingMs: number) => {
      clearDisplayTimer();
      if (remainingMs <= 0) {
        openResponsePhase();
        return;
      }
      displayRemainingRef.current = remainingMs;
      displayStartedAtRef.current = performance.now();
      displayTimerRef.current = setTimeout(() => {
        displayTimerRef.current = null;
        if (shouldAdvanceDisplayOnTimer(isInteractionAllowed())) {
          displayRemainingRef.current = 0;
          displayStartedAtRef.current = null;
          openResponsePhase();
          return;
        }
        if (displayStartedAtRef.current !== null) {
          const elapsed = performance.now() - displayStartedAtRef.current;
          displayRemainingRef.current = Math.max(0, displayRemainingRef.current - elapsed);
          displayStartedAtRef.current = null;
        }
        if (displayRemainingRef.current <= 0) {
          resumeFromDisplayExpiryRef.current = true;
        }
      }, remainingMs);
    },
    [clearDisplayTimer, isInteractionAllowed, openResponsePhase],
  );

  const startSequentialDisplay = useCallback(
    (digits: number[]) => {
      clearDisplayTimer();
      let index = 0;
      setVisibleDigit(String(digits[0] ?? ""));
      digitTimerRef.current = setInterval(() => {
        index += 1;
        if (index >= digits.length) {
          clearDisplayTimer();
          openResponsePhase();
          return;
        }
        setVisibleDigit(String(digits[index]));
      }, SEQUENTIAL_DIGIT_MS);
    },
    [clearDisplayTimer, openResponsePhase],
  );

  useEffect(() => {
    const wasPaused = prevPausedRef.current;
    prevPausedRef.current = lifecycle.paused;

    if (phase !== "stimulus" || lifecycle.paused || sequential) {
      if (lifecycle.paused) {
        clearDisplayTimer();
        if (displayStartedAtRef.current !== null) {
          const elapsed = performance.now() - displayStartedAtRef.current;
          displayRemainingRef.current = Math.max(0, displayRemainingRef.current - elapsed);
          displayStartedAtRef.current = null;
        }
      }
      return;
    }

    if (wasPaused && resumeFromDisplayExpiryRef.current && displayTimerRef.current === null) {
      resumeFromDisplayExpiryRef.current = false;
      if (shouldAdvanceDisplayOnTimer(isInteractionAllowed())) {
        openResponsePhase();
      }
      return;
    }

    if (displayRemainingRef.current > 0 && displayTimerRef.current === null) {
      scheduleDisplayEnd(displayRemainingRef.current);
    }
  }, [
    clearDisplayTimer,
    isInteractionAllowed,
    lifecycle.paused,
    openResponsePhase,
    phase,
    scheduleDisplayEnd,
    sequential,
  ]);

  useEffect(() => () => clearDisplayTimer(), [clearDisplayTimer]);

  const showStimulus = useCallback(
    async (plan: DigitSpanAttemptPlan, useSequential: boolean) => {
      clearDisplayTimer();
      setCurrentAttempt(plan);
      setPhase("stimulus");
      setResponseDigits([]);
      setVisibleDigit("");
      displayRemainingRef.current = 0;
      displayStartedAtRef.current = null;
      resumeFromDisplayExpiryRef.current = false;

      try {
        await lifecycle.appendEvent("span.stimulus", {
          mode: plan.mode,
          length: plan.length,
          attemptIndex: plan.attemptIndex,
          sequence: plan.digits,
        });
        if (useSequential) {
          startSequentialDisplay(plan.digits);
          return;
        }
        setVisibleDigit(plan.digits.join(" "));
        const displayMs = wholeSequenceDisplayMs(plan.length);
        const displayAction = displayActionAfterAppend(isInteractionAllowed(), displayMs);
        if (displayAction.action === "schedule") {
          scheduleDisplayEnd(displayAction.ms);
        } else {
          displayRemainingRef.current = displayAction.ms;
        }
      } catch {
        setPhase("stimulus");
      }
    },
    [
      clearDisplayTimer,
      isInteractionAllowed,
      lifecycle,
      scheduleDisplayEnd,
      startSequentialDisplay,
    ],
  );

  const submitResponse = useCallback(async () => {
    const attempt = currentAttemptRef.current;
    const digits = responseDigitsRef.current;
    if (!lifecycle.session || !attempt || interactionLocked || phaseRef.current !== "response") {
      return;
    }
    if (digits.length !== attempt.length) return;

    try {
      await lifecycle.appendEvent("span.response", {
        mode: attempt.mode,
        length: attempt.length,
        attemptIndex: attempt.attemptIndex,
        sequence: attempt.digits,
        response: digits,
      });

      const nextIndex = attemptIndex + 1;
      if (nextIndex >= attempts.length) {
        await lifecycle.submitSession();
        return;
      }

      setAttemptIndex(nextIndex);
      await showStimulus(attempts[nextIndex]!, sequential);
    } catch {
      // keep response phase for retry
    }
  }, [attemptIndex, attempts, interactionLocked, lifecycle, sequential, showStimulus]);

  const appendDigit = useCallback(
    (digit: number) => {
      const attempt = currentAttemptRef.current;
      if (phaseRef.current !== "response" || !attempt || interactionLocked) {
        return;
      }
      setResponseDigits((prev) => {
        if (prev.length >= attempt.length) return prev;
        return [...prev, digit];
      });
    },
    [interactionLocked],
  );

  const beginTraining = useCallback(async () => {
    const started = await lifecycle.beginSession();
    if (!started) return;
    const plan = buildDigitSpanAttemptPlan(started.ageBand, difficulty);
    const useSequential = difficulty === "hard";
    setAttempts(plan);
    setSequential(useSequential);
    setAttemptIndex(0);
    setUiPhase("stimulus");
    await showStimulus(plan[0]!, useSequential);
  }, [difficulty, lifecycle, showStimulus]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (phaseRef.current !== "response" || interactionLocked) return;

      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        appendDigit(Number(event.key));
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        setResponseDigits((prev) => prev.slice(0, -1));
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void submitResponse();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appendDigit, interactionLocked, submitResponse]);

  if (lifecycle.loading) {
    return (
      <PageShell title="数字广度">
        <LoadingState label="准备训练…" />
      </PageShell>
    );
  }

  if (lifecycle.error && uiPhase === "intro" && !lifecycle.session) {
    return (
      <PageShell title="数字广度" backHref={lifecycle.hubPath}>
        <Alert tone="error">{lifecycle.error}</Alert>
      </PageShell>
    );
  }

  const modeLabel = currentAttempt?.mode === "backward" ? "倒背" : "顺背";

  return (
    <PageShell
      title="数字广度"
      subtitle={
        uiPhase === "intro"
          ? "说明与难度"
          : `第 ${Math.min(attemptIndex + 1, attempts.length || 1)} / ${attempts.length || "—"} 次 · ${modeLabel}`
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
      {lifecycle.error && uiPhase !== "intro" ? <Alert tone="error">{lifecycle.error}</Alert> : null}

      {uiPhase === "intro" ? (
        <section className="space-y-4 rounded-3xl border border-[var(--bd-border)] bg-white p-5" data-testid="digit-span-intro">
          <p className="text-sm text-slate-700">
            记住屏幕上的数字序列后按规则输入。数字为真随机（相邻位不会相同）。
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              <strong>简单 · 顺背</strong>：全部按出现顺序回忆，数字一次全部显示。
            </li>
            <li>
              <strong>简单 · 倒背</strong>：全部按相反顺序回忆，数字一次全部显示。
            </li>
            <li>
              <strong>困难</strong>：顺背与倒背随机混合；数字逐个闪现，每位 0.8 秒。
            </li>
          </ul>
          <p className="text-sm text-slate-600">
            各难度均为 16 次；长度从 4 位起。整串显示：≤5 位 2 秒，6–8 位 4 秒，9–14 位 7 秒，15 位及以上 10 秒。
          </p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-800">难度</legend>
            {(
              [
                ["hard", "困难 · 顺背/倒背随机 + 逐位显示（16 次）"],
                ["easy_forward", "简单 · 全部顺背（16 次，4 位起）"],
                ["easy_backward", "简单 · 全部倒背（16 次，4 位起）"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="digit-difficulty"
                  checked={difficulty === value}
                  onChange={() => setDifficulty(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <PrimaryButton
            data-testid="digit-span-start"
            disabled={lifecycle.starting}
            onClick={() => void beginTraining()}
          >
            {lifecycle.starting ? "正在开始…" : "开始"}
          </PrimaryButton>
        </section>
      ) : (
        <>
          {currentAttempt ? (
            <section
              className="rounded-xl border border-neutral-300 bg-white p-4"
              data-mode={currentAttempt.mode}
              data-length={currentAttempt.length}
              data-attempt-index={currentAttempt.attemptIndex}
              data-digits={currentAttempt.digits.join(",")}
              data-phase={phase}
            >
              <p className="text-xs text-neutral-500">
                {modeLabel} · 长度 {currentAttempt.length} · 第 {currentAttempt.attemptIndex + 1}{" "}
                次尝试
              </p>
              {phase === "stimulus" ? (
                <>
                  <p className="mt-2 text-xs text-neutral-500" data-testid="digit-stimulus-label">
                    {sequential ? "请记住依次出现的数字" : "请记住以下数字序列"}
                  </p>
                  <p
                    className="mt-3 text-3xl font-bold tracking-widest text-neutral-900"
                    data-testid="digit-stimulus"
                  >
                    {visibleDigit || "…"}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-neutral-700" data-testid="digit-recall-prompt">
                  {currentAttempt.mode === "forward"
                    ? "请按相同顺序输入数字"
                    : "请按相反顺序输入数字"}
                </p>
              )}
            </section>
          ) : null}

          <div
            className="min-h-11 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-lg font-medium tracking-widest"
            data-testid="digit-response"
            data-ready={phase === "response" ? "true" : "false"}
            aria-live="polite"
          >
            {responseDigits.length > 0 ? responseDigits.join(" ") : "—"}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit) => (
              <TrainingButton
                key={digit}
                variant="option"
                data-testid={`digit-key-${digit}`}
                disabled={phase !== "response" || interactionLocked}
                onClick={() => appendDigit(digit)}
                className="min-h-11 px-2"
              >
                {digit}
              </TrainingButton>
            ))}
          </div>

          <div className="flex gap-2">
            <TrainingButton
              variant="option"
              data-testid="digit-clear"
              disabled={phase !== "response" || interactionLocked}
              onClick={() => setResponseDigits([])}
              className="flex-1"
            >
              清除
            </TrainingButton>
            <TrainingButton
              data-testid="digit-submit"
              disabled={
                phase !== "response" ||
                interactionLocked ||
                responseDigits.length !== (currentAttempt?.length ?? 0)
              }
              onClick={() => void submitResponse()}
              className="flex-1"
            >
              确认（Enter）
            </TrainingButton>
          </div>

          {lifecycle.submitting ? <LoadingState label="正在提交训练结果…" /> : null}
        </>
      )}
    </PageShell>
  );
}
