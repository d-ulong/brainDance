import { describe, expect, it } from "vitest";
import {
  executionEditDeadline,
  finishExecution,
  readChecklist,
  transitionPomodoro,
  validateFinalPomodoro,
} from "@/modules/schedule/execution-state";
import { isPastPlanSettlementDeadline } from "@/modules/time-policy/plan-settlement-deadline";

describe("execution state", () => {
  it("retains homework metadata and per-subtask timing through serialization", () => {
    const task = {
      id: "math",
      title: "数学",
      completed: false,
      difficulty: "较难",
      durationMinutes: 35,
      startedAt: "2026-01-15T10:00:00.000Z",
    };
    expect(readChecklist(JSON.parse(JSON.stringify([task])))).toEqual([task]);
  });
  it("stops a paused timer and excludes its final pause", () => {
    let timer = transitionPomodoro({}, "start", new Date("2026-01-15T10:00:00Z"));
    timer = transitionPomodoro(timer, "pause", new Date("2026-01-15T10:05:00Z"));
    timer = transitionPomodoro(timer, "resume", new Date("2026-01-15T10:07:00Z"));
    timer = transitionPomodoro(timer, "pause", new Date("2026-01-15T10:10:00Z"));
    timer = transitionPomodoro(timer, "stop", new Date("2026-01-15T10:12:00Z"));
    expect(timer).toMatchObject({
      state: "stopped",
      pauseCount: 2,
      pausedSeconds: 240,
      focusedSeconds: 480,
    });
    expect(timer.pausedAt).toBeUndefined();
    expect(() => transitionPomodoro(timer, "resume", new Date())).toThrow();
  });
  it("finishes both parent and homework timers without changing input history", () => {
    const timer = transitionPomodoro({}, "start", new Date("2026-01-15T10:00:00Z"));
    const snapshot = {
      revision: 2,
      taskType: "homework" as const,
      checklist: [{ id: "a", title: "a", completed: true, pomodoro: timer }],
      pomodoro: timer,
      all_completed: true,
    };
    const done = finishExecution(snapshot, new Date("2026-01-15T10:10:00Z"));
    expect(done.pomodoro.focusedSeconds).toBe(600);
    expect(done.checklist[0]?.pomodoro?.state).toBe("stopped");
    expect(snapshot.pomodoro.state).toBe("running");
  });
  it("allows parent corrections through day60 and closes at day61 midnight", () => {
    expect(executionEditDeadline("2026-01-15", "student").toISOString()).toBe(
      "2026-01-15T16:00:00.000Z",
    );
    expect(executionEditDeadline("2026-01-15", "parent").toISOString()).toBe(
      "2026-03-16T16:00:00.000Z",
    );
  });
  it("uses identical exclusive completion and settlement cutoffs", () => {
    expect(isPastPlanSettlementDeadline("2026-01-15", new Date("2026-01-16T13:59:59.999Z"))).toBe(
      false,
    );
    expect(isPastPlanSettlementDeadline("2026-01-15", new Date("2026-01-16T14:00:00Z"))).toBe(true);
  });
  it("derives corrected focus from the final interval and rejects impossible pauses", () => {
    expect(
      validateFinalPomodoro(
        {
          state: "stopped",
          startedAt: "2026-01-15T10:00:00Z",
          stoppedAt: "2026-01-15T10:10:00Z",
          pausedSeconds: 100,
          focusedSeconds: 500,
        },
        new Date("2026-01-15T11:00:00Z"),
      ).focusedSeconds,
    ).toBe(500);
    expect(() =>
      validateFinalPomodoro(
        {
          state: "stopped",
          startedAt: "2026-01-15T10:00:00Z",
          stoppedAt: "2026-01-15T10:10:00Z",
          pausedSeconds: 100,
          focusedSeconds: 9999,
        },
        new Date("2026-01-15T11:00:00Z"),
      ),
    ).toThrow("专注时长须等于计时区间减去暂停时间");
    expect(() =>
      validateFinalPomodoro(
        {
          state: "stopped",
          startedAt: "2026-01-15T10:00:00Z",
          stoppedAt: "2026-01-15T10:10:00Z",
          pausedSeconds: 601,
        },
        new Date("2026-01-15T11:00:00Z"),
      ),
    ).toThrow();
  });
});
