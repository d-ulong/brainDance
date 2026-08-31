export type InteractionGate = () => boolean;

export type PendingStimulusGate = ReturnType<typeof createPendingStimulusGate>;

export function createPendingStimulusGate(isAllowed: InteractionGate) {
  let pending = false;

  return {
    reset() {
      pending = false;
    },
    afterAppendSuccess(): "open" | "defer" {
      if (isAllowed()) {
        pending = false;
        return "open";
      }
      pending = true;
      return "defer";
    },
    onGateOpen(): "open" | "noop" {
      if (pending && isAllowed()) {
        pending = false;
        return "open";
      }
      return "noop";
    },
    isPending: () => pending,
  };
}

export function displayActionAfterAppend(
  allowed: boolean,
  displayMs: number,
): { action: "schedule"; ms: number } | { action: "save"; ms: number } {
  if (allowed) {
    return { action: "schedule", ms: displayMs };
  }
  return { action: "save", ms: displayMs };
}

export function shouldAdvanceDisplayOnTimer(allowed: boolean): boolean {
  return allowed;
}
