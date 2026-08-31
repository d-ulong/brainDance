/**
 * @vitest-environment happy-dom
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DigitSpanTrainingPage from "@/app/student/training/digit-span/page";
import { createPendingStimulusGate } from "@/components/training/pending-stimulus-gate";
import {
  useTrainingSessionLifecycle,
  type TrainingSessionLifecycle,
} from "@/components/training/use-training-session-lifecycle";
import type {
  AppendTrainingEventResult,
  StartTrainingSessionResult,
} from "@/lib/client/training-api";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/lib/client/api", () => ({
  fetchSession: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, body: { error?: string }) {
      super(body.error ?? "Request failed");
      this.status = status;
    }
  },
}));

vi.mock("@/lib/client/training-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/training-api")>();
  return {
    ...actual,
    startTrainingSession: vi.fn(),
    appendTrainingEvent: vi.fn(),
    submitTrainingSession: vi.fn(),
    newIdempotencyKey: vi.fn(() => "test-key"),
  };
});

import { fetchSession } from "@/lib/client/api";
import { appendTrainingEvent, startTrainingSession } from "@/lib/client/training-api";

const sessionResult: StartTrainingSessionResult = {
  sessionId: "sess-p3-r06",
  trainingKey: "reaction",
  definitionVersion: 1,
  ageBand: "6-8",
  familyDate: "2026-08-30",
  expectedTrialCount: 5,
  status: "active",
  idempotentReplay: false,
};

const digitSpanSession: StartTrainingSessionResult = {
  ...sessionResult,
  trainingKey: "digit-span",
  expectedTrialCount: 0,
};

function appendOk(sequence = 0): AppendTrainingEventResult {
  return {
    sequence,
    occurredAt: new Date().toISOString(),
    blurAccumulatedMs: 0,
    abandoned: false,
  };
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

type DeferredStimulusApi = {
  getLifecycle: () => TrainingSessionLifecycle;
  showStimulus: () => Promise<void>;
  awaitingResponseRef: { current: boolean };
  getGate: () => ReturnType<typeof createPendingStimulusGate>;
};

function DeferredStimulusHarness({ onReady }: { onReady: (api: DeferredStimulusApi) => void }) {
  const lifecycle = useTrainingSessionLifecycle("reaction");
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const awaitingResponseRef = useRef(false);
  const [, setAwaitingResponse] = useState(false);
  const isInteractionAllowed = lifecycle.isInteractionAllowed;
  const gateRef = useRef(createPendingStimulusGate(() => isInteractionAllowed()));
  const readyRef = useRef(false);

  useEffect(() => {
    gateRef.current = createPendingStimulusGate(() => isInteractionAllowed());
  }, [isInteractionAllowed]);

  const showStimulus = useCallback(async () => {
    awaitingResponseRef.current = false;
    setAwaitingResponse(false);
    gateRef.current.reset();
    await lifecycleRef.current.appendEvent("trial.stimulus", {
      trialIndex: 0,
      stimulusId: "s-0",
    });
    if (gateRef.current.afterAppendSuccess() === "open") {
      awaitingResponseRef.current = true;
      setAwaitingResponse(true);
    }
  }, []);

  useEffect(() => {
    if (gateRef.current.onGateOpen() === "open") {
      awaitingResponseRef.current = true;
      setAwaitingResponse(true);
    }
  }, [lifecycle.paused, lifecycle.terminated]);

  useEffect(() => {
    if (!lifecycle.session || lifecycle.loading || readyRef.current) return;
    readyRef.current = true;
    onReady({
      getLifecycle: () => lifecycleRef.current,
      showStimulus,
      awaitingResponseRef,
      getGate: () => gateRef.current,
    });
  }, [lifecycle.session, lifecycle.loading, onReady, showStimulus]);

  return null;
}

function setPerformanceNow(value: number) {
  vi.spyOn(performance, "now").mockReturnValue(value);
}

describe("P3-R06-C1 lifecycle gate sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDocumentHidden(false);
    vi.mocked(fetchSession).mockResolvedValue({
      role: "student",
      mustChangePassword: false,
    } as Awaited<ReturnType<typeof fetchSession>>);
    vi.mocked(startTrainingSession).mockResolvedValue(sessionResult);
  });

  afterEach(() => {
    setDocumentHidden(false);
  });

  it("blocks deferred stimulus before React rerender after visibilitychange", async () => {
    let resolveAppend!: (value: AppendTrainingEventResult) => void;
    const appendPromise = new Promise<AppendTrainingEventResult>((resolve) => {
      resolveAppend = resolve;
    });
    vi.mocked(appendTrainingEvent).mockReturnValue(appendPromise);

    let api!: DeferredStimulusApi;
    render(
      <DeferredStimulusHarness
        onReady={(ready) => {
          api = ready;
        }}
      />,
    );

    await waitFor(() => expect(api).toBeDefined());

    let showTask!: Promise<void>;
    await act(async () => {
      showTask = api.showStimulus();
      await Promise.resolve();
    });

    setDocumentHidden(true);
    fireVisibilityChange();

    expect(api.getLifecycle().isInteractionAllowed()).toBe(false);

    resolveAppend(appendOk());
    await act(async () => {
      await showTask;
    });

    expect(api.awaitingResponseRef.current).toBe(false);
    expect(api.getGate().isPending()).toBe(true);
  });

  it("syncs initial hidden when blur binding enables", async () => {
    setDocumentHidden(true);
    vi.mocked(appendTrainingEvent).mockResolvedValue(appendOk());

    let api!: DeferredStimulusApi;
    render(
      <DeferredStimulusHarness
        onReady={(ready) => {
          api = ready;
        }}
      />,
    );

    await waitFor(() => expect(api).toBeDefined());
    expect(api.getLifecycle().isInteractionAllowed()).toBe(false);
    await waitFor(() => expect(api.getLifecycle().paused).toBe(true));
  });

  it("never opens interaction after recovery failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setPerformanceNow(0);
    vi.mocked(appendTrainingEvent).mockImplementation(async (_sessionId, _seq, eventType) => {
      if (eventType === "session.blur") {
        throw new Error("network");
      }
      return appendOk();
    });

    let api!: DeferredStimulusApi;
    render(
      <DeferredStimulusHarness
        onReady={(ready) => {
          api = ready;
        }}
      />,
    );

    await waitFor(() => expect(api).toBeDefined());

    await act(async () => {
      await api.showStimulus();
    });
    expect(api.awaitingResponseRef.current).toBe(true);

    await act(async () => {
      setPerformanceNow(100);
      setDocumentHidden(true);
      fireVisibilityChange();
      setPerformanceNow(250);
      setDocumentHidden(false);
      fireVisibilityChange();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await waitFor(() => expect(api.getLifecycle().terminated).toBe(true));
    expect(api.getLifecycle().isInteractionAllowed()).toBe(false);

    api.awaitingResponseRef.current = false;
    act(() => {
      expect(api.getGate().onGateOpen()).toBe("noop");
    });
    expect(api.awaitingResponseRef.current).toBe(false);
    vi.useRealTimers();
  });

  it("never opens interaction after blur abandoned", async () => {
    setPerformanceNow(0);
    vi.mocked(appendTrainingEvent).mockImplementation(async (_sessionId, _seq, eventType) => {
      if (eventType === "session.blur") {
        return { ...appendOk(), abandoned: true };
      }
      return appendOk();
    });

    let api!: DeferredStimulusApi;
    render(
      <DeferredStimulusHarness
        onReady={(ready) => {
          api = ready;
        }}
      />,
    );

    await waitFor(() => expect(api).toBeDefined());

    await act(async () => {
      await api.showStimulus();
    });

    await act(async () => {
      setPerformanceNow(100);
      setDocumentHidden(true);
      fireVisibilityChange();
      setPerformanceNow(250);
      setDocumentHidden(false);
      fireVisibilityChange();
    });

    await waitFor(() => expect(api.getLifecycle().terminated).toBe(true));
    expect(api.getLifecycle().isInteractionAllowed()).toBe(false);
    expect(api.getGate().onGateOpen()).toBe("noop");
  });
});

describe("P3-R06-C2 digit-span timer lifecycle", () => {
  let mockNow = 0;

  beforeEach(() => {
    mockNow = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(performance, "now").mockImplementation(() => mockNow);
    vi.clearAllMocks();
    setDocumentHidden(false);
    vi.mocked(fetchSession).mockResolvedValue({
      role: "student",
      mustChangePassword: false,
    } as Awaited<ReturnType<typeof fetchSession>>);
    vi.mocked(startTrainingSession).mockResolvedValue(digitSpanSession);
    vi.mocked(appendTrainingEvent).mockResolvedValue(appendOk());
  });

  afterEach(() => {
    vi.useRealTimers();
    setDocumentHidden(false);
  });

  it("preserves remaining time when timer fires during hidden/pause-effect race", async () => {
    render(<DigitSpanTrainingPage />);

    await waitFor(() => expect(document.querySelector('[data-phase="stimulus"]')).toBeTruthy());

    await act(async () => {
      mockNow += 500;
      vi.advanceTimersByTime(500);
    });

    setDocumentHidden(true);
    fireVisibilityChange();

    await act(async () => {
      mockNow += 1300;
      vi.advanceTimersByTime(1300);
    });

    expect(document.querySelector('[data-phase="stimulus"]')).toBeTruthy();
    expect(document.querySelector('[data-ready="true"]')).toBeNull();

    setDocumentHidden(false);
    await act(async () => {
      fireVisibilityChange();
    });

    await waitFor(() => expect(document.querySelector('[data-phase="response"]')).toBeTruthy());
    expect(document.querySelector('[data-ready="true"]')).toBeTruthy();
  });
});
