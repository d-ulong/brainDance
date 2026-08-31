"use client";

import { useCallback, useEffect, useRef } from "react";

import type { AppendTrainingEventResult } from "@/lib/client/training-api";

type AppendEventFn = (
  eventType: string,
  payload: Record<string, unknown>,
) => Promise<AppendTrainingEventResult>;

type UseTrainingBlurOptions = {
  sessionId: string | null;
  enabled: boolean;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  appendEvent: AppendEventFn;
  onAbandoned: () => void;
};

export function useTrainingBlur({
  sessionId,
  enabled,
  setPaused,
  appendEvent,
  onAbandoned,
}: UseTrainingBlurOptions) {
  const blurStartRef = useRef<number | null>(null);
  const reportingRef = useRef(false);

  const reportBlur = useCallback(
    async (durationMs: number) => {
      if (!sessionId || durationMs <= 0 || reportingRef.current) return;
      reportingRef.current = true;
      try {
        const result = await appendEvent("session.blur", { durationMs: Math.round(durationMs) });
        if (result.abandoned) {
          onAbandoned();
        }
      } finally {
        reportingRef.current = false;
      }
    },
    [appendEvent, onAbandoned, sessionId],
  );

  useEffect(() => {
    if (!enabled || !sessionId) return;

    function handleVisibilityChange() {
      if (document.hidden) {
        blurStartRef.current = performance.now();
        setPaused(true);
        return;
      }

      const startedAt = blurStartRef.current;
      blurStartRef.current = null;
      setPaused(false);

      if (startedAt !== null) {
        const durationMs = performance.now() - startedAt;
        void reportBlur(durationMs);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, reportBlur, sessionId, setPaused]);
}
