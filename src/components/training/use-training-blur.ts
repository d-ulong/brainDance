"use client";

import { useEffect, useRef } from "react";

import { createTrainingBlurCoordinator } from "@/components/training/training-blur-coordinator";
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
  onRecoveryFailed: () => void;
};

export function useTrainingBlur({
  sessionId,
  enabled,
  setPaused,
  appendEvent,
  onAbandoned,
  onRecoveryFailed,
}: UseTrainingBlurOptions) {
  const appendEventRef = useRef(appendEvent);
  const setPausedRef = useRef(setPaused);
  const onAbandonedRef = useRef(onAbandoned);
  const onRecoveryFailedRef = useRef(onRecoveryFailed);

  appendEventRef.current = appendEvent;
  setPausedRef.current = setPaused;
  onAbandonedRef.current = onAbandoned;
  onRecoveryFailedRef.current = onRecoveryFailed;

  const coordinatorRef = useRef(
    createTrainingBlurCoordinator({
      appendEvent: (...args) => appendEventRef.current(...args),
      setPaused: (paused) => setPausedRef.current(paused),
      onAbandoned: () => onAbandonedRef.current(),
      onRecoveryFailed: () => onRecoveryFailedRef.current(),
      isDocumentHidden: () => document.hidden,
      now: () => performance.now(),
    }),
  );

  useEffect(() => {
    if (!enabled || !sessionId) return;

    function handleVisibilityChange() {
      coordinatorRef.current.onVisibilityChange();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, sessionId]);
}
