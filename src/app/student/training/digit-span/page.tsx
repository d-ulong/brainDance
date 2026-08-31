"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildDigitSpanAttemptPlan,
  type DigitSpanAttemptPlan,
} from "@/components/training/digit-span-plan";
import {
  displayActionAfterAppend,
  shouldAdvanceDisplayOnTimer,
} from "@/components/training/pending-stimulus-gate";
import { TrainingButton } from "@/components/training/training-button";
import { TrainingDisclaimer } from "@/components/training/training-disclaimer";
import { useTrainingSessionLifecycle } from "@/components/training/use-training-session-lifecycle";
import { Alert, LoadingState, PageShell } from "@/components/ui/page-shell";

type Phase = "stimulus" | "response";

const STIMULUS_BASE_MS = 400;
const STIMULUS_MS_PER_DIGIT = 700;

export default function DigitSpanTrainingPage() {
  const lifecycle = useTrainingSessionLifecycle("digit-span");
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("stimulus");
  const [currentAttempt, setCurrentAttempt] = useState<DigitSpanAttemptPlan | null>(null);
  const [responseDigits, setResponseDigits] = useState<number[]>([]);
  const initializedRef = useRef(false);
  const phaseRef = useRef<Phase>("stimulus");
  const currentAttemptRef = useRef<DigitSpanAttemptPlan | null>(null);
  const responseDigitsRef = useRef<number[]>([]);
  const displayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayRemainingRef = useRef(0);
  const displayStartedAtRef = useRef<number | null>(null);

  phaseRef.current = phase;
  currentAttemptRef.current = currentAttempt;
  responseDigitsRef.current = responseDigits;

  const attempts = useMemo(
    () => (lifecycle.session ? buildDigitSpanAttemptPlan(lifecycle.session.ageBand) : []),
    [lifecycle.session],
  );

  const interactionLocked =
    lifecycle.submitting || lifecycle.paused || lifecycle.terminated || Boolean(lifecycle.error);

  const clearDisplayTimer = useCallback(() => {
    if (displayTimerRef.current !== null) {
      clearTimeout(displayTimerRef.current);
      displayTimerRef.current = null;
    }
  }, []);

  const openResponsePhase = useCallback(() => {
    setPhase("response");
    displayRemainingRef.current = 0;
    displayStartedAtRef.current = null;
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
        displayRemainingRef.current = 0;
        displayStartedAtRef.current = null;
        if (shouldAdvanceDisplayOnTimer(isInteractionAllowed())) {
          openResponsePhase();
        }
      }, remainingMs);
    },
    [clearDisplayTimer, isInteractionAllowed, openResponsePhase],
  );

  useEffect(() => {
    if (phase !== "stimulus" || lifecycle.paused) {
      if (lifecycle.paused && displayStartedAtRef.current !== null) {
        const elapsed = performance.now() - displayStartedAtRef.current;
        displayRemainingRef.current = Math.max(0, displayRemainingRef.current - elapsed);
        displayStartedAtRef.current = null;
        clearDisplayTimer();
      }
      return;
    }

    if (displayRemainingRef.current > 0 && displayTimerRef.current === null) {
      scheduleDisplayEnd(displayRemainingRef.current);
    }
  }, [clearDisplayTimer, lifecycle.paused, phase, scheduleDisplayEnd]);

  useEffect(() => () => clearDisplayTimer(), [clearDisplayTimer]);

  const showStimulus = useCallback(
    async (plan: DigitSpanAttemptPlan) => {
      clearDisplayTimer();
      setCurrentAttempt(plan);
      setPhase("stimulus");
      setResponseDigits([]);
      displayRemainingRef.current = 0;
      displayStartedAtRef.current = null;

      try {
        await lifecycle.appendEvent("span.stimulus", {
          mode: plan.mode,
          length: plan.length,
          attemptIndex: plan.attemptIndex,
          sequence: plan.digits,
        });
        const displayMs = STIMULUS_BASE_MS + plan.length * STIMULUS_MS_PER_DIGIT;
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
    [clearDisplayTimer, isInteractionAllowed, lifecycle, scheduleDisplayEnd],
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
      await showStimulus(attempts[nextIndex]!);
    } catch {
      // keep response phase for retry
    }
  }, [attemptIndex, attempts, interactionLocked, lifecycle, showStimulus]);

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

  useEffect(() => {
    if (
      !lifecycle.session ||
      initializedRef.current ||
      attempts.length === 0 ||
      lifecycle.terminated
    ) {
      return;
    }
    initializedRef.current = true;
    void showStimulus(attempts[0]!);
  }, [attempts, lifecycle.session, lifecycle.terminated, showStimulus]);

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

  if (lifecycle.error) {
    return (
      <PageShell title="数字广度" backHref="/student/training">
        <Alert tone="error">{lifecycle.error}</Alert>
      </PageShell>
    );
  }

  const modeLabel = currentAttempt?.mode === "backward" ? "倒背" : "顺背";

  return (
    <PageShell
      title="数字广度"
      subtitle={`第 ${Math.min(attemptIndex + 1, attempts.length)} / ${attempts.length} 次 · ${modeLabel}`}
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

      {currentAttempt ? (
        <section
          className="rounded-xl border border-neutral-300 bg-white p-4"
          data-mode={currentAttempt.mode}
          data-length={currentAttempt.length}
          data-attempt-index={currentAttempt.attemptIndex}
          data-phase={phase}
        >
          <p className="text-xs text-neutral-500">
            {modeLabel} · 长度 {currentAttempt.length} · 第 {currentAttempt.attemptIndex + 1} 次尝试
          </p>
          {phase === "stimulus" ? (
            <>
              <p className="mt-2 text-xs text-neutral-500" data-testid="digit-stimulus-label">
                请记住以下数字序列
              </p>
              <p
                className="mt-3 text-3xl font-bold tracking-widest text-neutral-900"
                data-testid="digit-stimulus"
              >
                {currentAttempt.digits.join(" ")}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-neutral-700" data-testid="digit-recall-prompt">
              {currentAttempt.mode === "forward" ? "请按相同顺序输入数字" : "请按相反顺序输入数字"}
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
    </PageShell>
  );
}
