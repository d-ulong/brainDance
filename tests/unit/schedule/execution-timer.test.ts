import { describe, expect, it } from "vitest";
import {
  familyInputValue,
  finalTimerFromInputs,
  parseFamilyInput,
} from "@/lib/schedule/execution-timer";
import { validateFinalPomodoro } from "@/modules/schedule/execution-state";

describe("execution timer form contract", () => {
  it("round-trips family local seconds independently of the device timezone", () => {
    const instant = new Date("2026-10-16T03:22:17Z");
    const display = familyInputValue(instant);
    expect(display).toBe("2026-10-16T11:22:17");
    expect(parseFamilyInput(display)).toEqual(instant);
  });
  it("derives focused seconds instead of submitting a contradictory editable total", () => {
    const timer = finalTimerFromInputs("2026-10-16T11:00:00", "2026-10-16T11:10:00", "2", "1");
    expect(timer).toEqual({
      state: "stopped",
      startedAt: "2026-10-16T03:00:00.000Z",
      stoppedAt: "2026-10-16T03:10:00.000Z",
      pausedSeconds: 120,
      pauseCount: 1,
      focusedSeconds: 480,
    });
    expect(validateFinalPomodoro(timer!, new Date("2026-10-16T04:00:00Z"))).toEqual(timer);
    const seconds = finalTimerFromInputs(
      "2026-10-16T11:00:00",
      "2026-10-16T11:10:17",
      String(17 / 60),
      "1",
    );
    expect(seconds?.focusedSeconds).toBe(600);
    expect(validateFinalPomodoro(seconds!, new Date("2026-10-16T04:00:00Z"))).toEqual(seconds);
  });
  it("rejects missing, negative, fractional-count or impossible timer fields", () => {
    for (const [paused, count] of [
      ["-1", "1"],
      ["-0.0001", "1"],
      ["11", "1"],
      ["2", "1.5"],
      ["NaN", "1"],
    ])
      expect(
        finalTimerFromInputs("2026-10-16T11:00:00", "2026-10-16T11:10:00", paused!, count!),
      ).toBeNull();
    expect(finalTimerFromInputs("", "", "0", "0")).toBeNull();
  });
});
