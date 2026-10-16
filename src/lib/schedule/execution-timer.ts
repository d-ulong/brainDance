import type { TaskTimerDto } from "@/lib/client/m2-api";

export function familyInputValue(value: Date): string {
  return new Date(value.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 19);
}

export function parseFamilyInput(value: string): Date | null {
  const parsed = new Date(`${value}+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** A final timer has one arithmetic authority: elapsed time minus pauses. */
export function finalTimerFromInputs(
  startedAt: string,
  stoppedAt: string,
  pausedMinutes: string,
  pauseCount: string,
): TaskTimerDto | null {
  const start = parseFamilyInput(startedAt);
  const stop = parseFamilyInput(stoppedAt);
  const pausedValue = Number(pausedMinutes || 0);
  const pausedSeconds = Math.round(pausedValue * 60);
  const count = Number(pauseCount || 0);
  if (
    !start ||
    !stop ||
    pausedValue < 0 ||
    !Number.isSafeInteger(pausedSeconds) ||
    pausedSeconds < 0 ||
    !Number.isSafeInteger(count) ||
    count < 0
  )
    return null;
  const elapsed = Math.floor((stop.getTime() - start.getTime()) / 1000);
  if (elapsed < 0 || pausedSeconds > elapsed) return null;
  return {
    state: "stopped",
    startedAt: start.toISOString(),
    stoppedAt: stop.toISOString(),
    pausedSeconds,
    pauseCount: count,
    focusedSeconds: elapsed - pausedSeconds,
  };
}
