"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { createTrainingEventQueue } from "@/components/training/training-event-queue";
import { useTrainingBlur } from "@/components/training/use-training-blur";
import { ApiError, fetchSession } from "@/lib/client/api";
import {
  appendTrainingEvent,
  newIdempotencyKey,
  startTrainingSession,
  submitTrainingSession,
  type AppendTrainingEventResult,
  type StartTrainingSessionResult,
  type TrainingKey,
} from "@/lib/client/training-api";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 800;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type TrainingSessionLifecycle = {
  loading: boolean;
  error: string | null;
  session: StartTrainingSessionResult | null;
  paused: boolean;
  pendingRetry: boolean;
  submitting: boolean;
  terminated: boolean;
  isInteractionAllowed: () => boolean;
  appendEvent: (
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<AppendTrainingEventResult>;
  submitSession: () => Promise<void>;
  navigateToResult: () => void;
};

export function useTrainingSessionLifecycle(trainingKey: TrainingKey): TrainingSessionLifecycle {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<StartTrainingSessionResult | null>(null);
  const [paused, setPaused] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [terminated, setTerminated] = useState(false);
  const sequenceRef = useRef(0);
  const startedRef = useRef(false);
  const submitKeyRef = useRef<string | null>(null);
  const eventQueueRef = useRef(createTrainingEventQueue<AppendTrainingEventResult>());
  const terminatedRef = useRef(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const markTerminated = useCallback((message: string) => {
    if (terminatedRef.current) return;
    terminatedRef.current = true;
    setTerminated(true);
    setError(message);
    setSubmitting(false);
    setPendingRetry(false);
    setPaused(true);
  }, []);

  const handleAbandoned = useCallback(() => {
    markTerminated("训练因失焦时间过长已终止，请重新开始。");
  }, [markTerminated]);

  const handleRecoveryFailed = useCallback(() => {
    markTerminated("失焦恢复失败，训练已终止，请重新开始。");
  }, [markTerminated]);

  const isInteractionAllowed = useCallback(() => !pausedRef.current && !terminatedRef.current, []);

  const appendEventInternal = useCallback(
    async (
      eventType: string,
      payload: Record<string, unknown>,
    ): Promise<AppendTrainingEventResult> => {
      if (!session) {
        throw new Error("训练会话未就绪");
      }
      if (terminatedRef.current) {
        throw new Error("训练已终止");
      }

      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        try {
          setPendingRetry(attempt > 0);
          const result = await appendTrainingEvent(
            session.sessionId,
            sequenceRef.current,
            eventType,
            payload,
          );
          sequenceRef.current += 1;
          setPendingRetry(false);
          if (result.abandoned) {
            handleAbandoned();
          }
          return result;
        } catch (err) {
          lastError = err;
          if (attempt < MAX_RETRIES - 1) {
            await sleep(RETRY_DELAY_MS);
          }
        }
      }

      setPendingRetry(false);
      throw lastError instanceof ApiError ? lastError : new Error("事件提交失败，请检查网络后重试");
    },
    [handleAbandoned, session],
  );

  const appendEvent = useCallback(
    async (
      eventType: string,
      payload: Record<string, unknown>,
    ): Promise<AppendTrainingEventResult> => {
      if (terminatedRef.current) {
        throw new Error("训练已终止");
      }
      return eventQueueRef.current.enqueue(() => appendEventInternal(eventType, payload));
    },
    [appendEventInternal],
  );

  useTrainingBlur({
    sessionId: session?.sessionId ?? null,
    enabled: !loading && !error && !submitting && !terminated,
    paused,
    setPaused,
    appendEvent,
    onAbandoned: handleAbandoned,
    onRecoveryFailed: handleRecoveryFailed,
  });

  useEffect(() => {
    void (async () => {
      const auth = await fetchSession();
      if (!auth || auth.role !== "student") {
        router.replace("/login");
        return;
      }
      if (auth.mustChangePassword) {
        router.replace("/student/change-password");
        return;
      }

      if (startedRef.current) {
        setLoading(false);
        return;
      }
      startedRef.current = true;

      try {
        const started = await startTrainingSession(trainingKey);
        sequenceRef.current = 0;
        setSession(started);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "无法开始训练");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, trainingKey]);

  const submitSession = useCallback(async () => {
    if (!session || submitting || terminatedRef.current) return;
    setSubmitting(true);
    setError(null);

    const idempotencyKey = submitKeyRef.current ?? newIdempotencyKey("submit-training");
    submitKeyRef.current = idempotencyKey;

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        setPendingRetry(attempt > 0);
        await submitTrainingSession(session.sessionId, idempotencyKey);
        setPendingRetry(false);
        router.push(`/student/training/${session.sessionId}`);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    setPendingRetry(false);
    setSubmitting(false);
    setError(lastError instanceof ApiError ? lastError.message : "提交失败，请检查网络后重试");
  }, [router, session, submitting]);

  const navigateToResult = useCallback(() => {
    if (session) {
      router.push(`/student/training/${session.sessionId}`);
    }
  }, [router, session]);

  return {
    loading,
    error,
    session,
    paused,
    pendingRetry,
    submitting,
    terminated,
    isInteractionAllowed,
    appendEvent,
    submitSession,
    navigateToResult,
  };
}

export function useKeyboardAction(handler: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        handler();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handler]);
}
