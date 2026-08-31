import { describe, expect, it } from "vitest";

import {
  createPendingStimulusGate,
  displayActionAfterAppend,
  shouldAdvanceDisplayOnTimer,
} from "@/components/training/pending-stimulus-gate";

describe("createPendingStimulusGate (P3-R06)", () => {
  it("defers opening response when append resolves while hidden", () => {
    let allowed = false;
    const gate = createPendingStimulusGate(() => allowed);

    gate.reset();
    expect(gate.afterAppendSuccess()).toBe("defer");
    expect(gate.isPending()).toBe(true);

    allowed = true;
    expect(gate.onGateOpen()).toBe("open");
    expect(gate.isPending()).toBe(false);
  });

  it("opens immediately when append resolves while visible", () => {
    const allowed = true;
    const gate = createPendingStimulusGate(() => allowed);

    gate.reset();
    expect(gate.afterAppendSuccess()).toBe("open");
    expect(gate.isPending()).toBe(false);
    expect(gate.onGateOpen()).toBe("noop");
  });

  it("never opens after gate stays blocked following deferred append", () => {
    const allowed = false;
    const gate = createPendingStimulusGate(() => allowed);

    gate.reset();
    expect(gate.afterAppendSuccess()).toBe("defer");
    expect(gate.onGateOpen()).toBe("noop");
  });

  it("covers append pending hidden then still hidden then visible after blur recovery", () => {
    let allowed = false;
    const gate = createPendingStimulusGate(() => allowed);
    const opened: string[] = [];

    gate.reset();
    const first = gate.afterAppendSuccess();
    if (first === "open") {
      opened.push("immediate");
    }

    expect(gate.onGateOpen()).toBe("noop");

    allowed = true;
    if (gate.onGateOpen() === "open") {
      opened.push("after-recovery");
    }

    expect(opened).toEqual(["after-recovery"]);
  });
});

describe("displayActionAfterAppend (P3-R06 digit-span)", () => {
  it("schedules display timer only when interaction is allowed after append", () => {
    expect(displayActionAfterAppend(true, 1800)).toEqual({ action: "schedule", ms: 1800 });
    expect(displayActionAfterAppend(false, 1800)).toEqual({ action: "save", ms: 1800 });
  });

  it("does not advance display timer while hidden", () => {
    expect(shouldAdvanceDisplayOnTimer(false)).toBe(false);
    expect(shouldAdvanceDisplayOnTimer(true)).toBe(true);
  });

  it("simulates deferred append with hidden timer and recovery resume", () => {
    let allowed = false;
    let phase: "stimulus" | "response" = "stimulus";
    let remainingMs = 0;
    let timerCreated = false;

    const appendResolved = () => {
      const action = displayActionAfterAppend(allowed, 1100);
      if (action.action === "schedule") {
        timerCreated = true;
      } else {
        remainingMs = action.ms;
      }
    };

    appendResolved();
    expect(timerCreated).toBe(false);
    expect(remainingMs).toBe(1100);
    expect(phase).toBe("stimulus");

    allowed = true;
    if (remainingMs > 0 && shouldAdvanceDisplayOnTimer(allowed)) {
      timerCreated = true;
    }

    expect(timerCreated).toBe(true);

    allowed = false;
    if (shouldAdvanceDisplayOnTimer(allowed)) {
      phase = "response";
    }
    expect(phase).toBe("stimulus");

    allowed = true;
    if (shouldAdvanceDisplayOnTimer(allowed)) {
      phase = "response";
    }
    expect(phase).toBe("response");
  });
});

describe("reaction/stroop deferred stimulus scenarios (P3-R06)", () => {
  it("reaction does not accept response while append pending and hidden", async () => {
    let allowed = false;
    let awaitingResponse = false;
    const gate = createPendingStimulusGate(() => allowed);

    gate.reset();
    awaitingResponse = false;

    let resolveAppend!: () => void;
    const appendPromise = new Promise<void>((resolve) => {
      resolveAppend = resolve;
    });

    const appendTask = appendPromise.then(() => {
      if (gate.afterAppendSuccess() === "open") {
        awaitingResponse = true;
      }
    });

    expect(awaitingResponse).toBe(false);

    resolveAppend();
    await appendTask;
    expect(awaitingResponse).toBe(false);
    expect(gate.isPending()).toBe(true);

    allowed = true;
    if (gate.onGateOpen() === "open") {
      awaitingResponse = true;
    }
    expect(awaitingResponse).toBe(true);
  });

  it("stroop keeps options disabled until deferred stimulus opens after recovery", async () => {
    let allowed = false;
    let awaitingResponse = false;
    const gate = createPendingStimulusGate(() => allowed);
    const responses: string[] = [];

    gate.reset();
    awaitingResponse = false;

    await Promise.resolve();
    if (gate.afterAppendSuccess() === "open") {
      awaitingResponse = true;
    }

    const tryRespond = () => {
      if (awaitingResponse && allowed) {
        responses.push("trial.response");
      }
    };

    tryRespond();
    expect(responses).toEqual([]);

    allowed = true;
    if (gate.onGateOpen() === "open") {
      awaitingResponse = true;
    }
    tryRespond();
    expect(responses).toEqual(["trial.response"]);
  });

  it("never opens response when gate remains terminated after deferred append", () => {
    const allowed = false;
    const gate = createPendingStimulusGate(() => allowed);

    gate.reset();
    expect(gate.afterAppendSuccess()).toBe("defer");
    expect(gate.onGateOpen()).toBe("noop");
  });
});
