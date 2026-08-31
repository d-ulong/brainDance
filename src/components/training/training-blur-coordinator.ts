import type { AppendTrainingEventResult } from "@/lib/client/training-api";

export type TrainingBlurCoordinatorDeps = {
  appendEvent: (
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<AppendTrainingEventResult>;
  setPaused: (paused: boolean) => void;
  onAbandoned: () => void;
  onRecoveryFailed: () => void;
  isDocumentHidden: () => boolean;
  now: () => number;
};

export type TrainingBlurCoordinator = ReturnType<typeof createTrainingBlurCoordinator>;

export function createTrainingBlurCoordinator(deps: TrainingBlurCoordinatorDeps) {
  let blurStart: number | null = null;
  const pendingDurations: number[] = [];
  let reporting = false;
  let terminal = false;

  function tryUnpause() {
    if (terminal || deps.isDocumentHidden() || pendingDurations.length > 0 || reporting) {
      return;
    }
    deps.setPaused(false);
  }

  async function flushQueue() {
    if (reporting || terminal || pendingDurations.length === 0) {
      tryUnpause();
      return;
    }

    reporting = true;
    try {
      while (pendingDurations.length > 0 && !terminal) {
        const durationMs = pendingDurations.shift()!;
        if (durationMs <= 0) {
          continue;
        }

        try {
          const result = await deps.appendEvent("session.blur", {
            durationMs: Math.round(durationMs),
          });
          if (result.abandoned) {
            terminal = true;
            deps.onAbandoned();
            return;
          }
        } catch {
          terminal = true;
          deps.onRecoveryFailed();
          return;
        }
      }
    } finally {
      reporting = false;
    }

    tryUnpause();
  }

  function onVisibilityChange() {
    if (terminal) {
      return;
    }

    if (deps.isDocumentHidden()) {
      if (blurStart === null) {
        blurStart = deps.now();
      }
      deps.setPaused(true);
      return;
    }

    if (blurStart !== null) {
      const durationMs = deps.now() - blurStart;
      blurStart = null;
      if (durationMs > 0) {
        pendingDurations.push(durationMs);
      }
      void flushQueue();
      return;
    }

    tryUnpause();
  }

  return {
    onVisibilityChange,
    getPendingCount: () => pendingDurations.length,
    isReporting: () => reporting,
    isTerminal: () => terminal,
    getBlurStart: () => blurStart,
  };
}
