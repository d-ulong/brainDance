import { describe, expect, it, vi } from "vitest";

import { createTrainingBlurCoordinator } from "@/components/training/training-blur-coordinator";
import type { AppendTrainingEventResult } from "@/lib/client/training-api";

type DeferredAppend = {
  resolve: (value: AppendTrainingEventResult) => void;
  reject: (error: Error) => void;
  promise: Promise<AppendTrainingEventResult>;
};

function blurResult(abandoned = false): AppendTrainingEventResult {
  return {
    sequence: 0,
    occurredAt: new Date().toISOString(),
    blurAccumulatedMs: 0,
    abandoned,
  };
}

function createDeferredAppend(): DeferredAppend {
  let resolve!: (value: AppendTrainingEventResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AppendTrainingEventResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForDeferred(deferred: DeferredAppend[], index: number) {
  while (deferred.length <= index) {
    await flushMicrotasks();
  }
}

describe("createTrainingBlurCoordinator (P3-R05)", () => {
  it("reports every visibility interval during interleaved hidden/visible while append is deferred", async () => {
    let hidden = false;
    let now = 0;
    let paused = false;
    const reported: number[] = [];
    const deferred: DeferredAppend[] = [];

    const coordinator = createTrainingBlurCoordinator({
      appendEvent: async (_eventType, payload) => {
        const deferredAppend = createDeferredAppend();
        deferred.push(deferredAppend);
        const result = await deferredAppend.promise;
        reported.push(payload.durationMs as number);
        return result;
      },
      setPaused: (value) => {
        paused = value;
      },
      onAbandoned: () => undefined,
      onRecoveryFailed: () => undefined,
      isDocumentHidden: () => hidden,
      now: () => now,
    });

    hidden = true;
    now = 100;
    coordinator.onVisibilityChange();

    hidden = false;
    now = 250;
    coordinator.onVisibilityChange();

    hidden = true;
    now = 300;
    coordinator.onVisibilityChange();

    hidden = false;
    now = 420;
    coordinator.onVisibilityChange();

    expect(reported).toEqual([]);
    expect(coordinator.isReporting()).toBe(true);
    expect(paused).toBe(true);

    deferred[0]!.resolve(blurResult());
    await deferred[0]!.promise;
    await flushMicrotasks();

    hidden = true;
    coordinator.onVisibilityChange();
    expect(paused).toBe(true);

    await waitForDeferred(deferred, 1);
    deferred[1]!.resolve(blurResult());
    await deferred[1]!.promise;
    await flushMicrotasks();

    expect(reported).toEqual([150, 120]);
    expect(paused).toBe(true);

    hidden = false;
    coordinator.onVisibilityChange();
    expect(paused).toBe(false);
  });

  it("keeps blur reports strictly serial and counts each interval", async () => {
    let hidden = false;
    let now = 0;
    const reported: number[] = [];
    const order: string[] = [];
    const deferred: DeferredAppend[] = [];

    const coordinator = createTrainingBlurCoordinator({
      appendEvent: async (_eventType, payload) => {
        order.push(`start:${(payload.durationMs as number) ?? 0}`);
        const deferredAppend = createDeferredAppend();
        deferred.push(deferredAppend);
        const result = await deferredAppend.promise;
        order.push(`end:${(payload.durationMs as number) ?? 0}`);
        reported.push(payload.durationMs as number);
        return result;
      },
      setPaused: () => undefined,
      onAbandoned: () => undefined,
      onRecoveryFailed: () => undefined,
      isDocumentHidden: () => hidden,
      now: () => now,
    });

    hidden = true;
    now = 0;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 100;
    coordinator.onVisibilityChange();

    hidden = true;
    now = 200;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 350;
    coordinator.onVisibilityChange();

    deferred[0]!.resolve(blurResult());
    await deferred[0]!.promise;
    await waitForDeferred(deferred, 1);
    deferred[1]!.resolve(blurResult());
    await deferred[1]!.promise;
    await flushMicrotasks();

    expect(reported).toEqual([100, 150]);
    expect(order).toEqual(["start:100", "end:100", "start:150", "end:150"]);
    expect(order.indexOf("end:100")).toBeLessThan(order.indexOf("start:150"));
  });

  it("does not unpause while hidden or while blur reports remain pending", async () => {
    let hidden = true;
    let now = 0;
    let paused = false;
    const deferred = createDeferredAppend();

    const coordinator = createTrainingBlurCoordinator({
      appendEvent: async () => deferred.promise,
      setPaused: (value) => {
        paused = value;
      },
      onAbandoned: () => undefined,
      onRecoveryFailed: () => undefined,
      isDocumentHidden: () => hidden,
      now: () => now,
    });

    hidden = true;
    now = 0;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 80;
    coordinator.onVisibilityChange();
    expect(paused).toBe(true);

    deferred.resolve(blurResult());
    await deferred.promise;

    hidden = true;
    coordinator.onVisibilityChange();
    expect(paused).toBe(true);
  });

  it("enters terminal state on abandoned and never unpauses", async () => {
    let hidden = false;
    let now = 0;
    let paused = true;
    let abandoned = false;

    const coordinator = createTrainingBlurCoordinator({
      appendEvent: async () => blurResult(true),
      setPaused: (value) => {
        paused = value;
      },
      onAbandoned: () => {
        abandoned = true;
      },
      onRecoveryFailed: () => undefined,
      isDocumentHidden: () => hidden,
      now: () => now,
    });

    hidden = true;
    now = 0;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 50;
    coordinator.onVisibilityChange();
    await Promise.resolve();

    expect(abandoned).toBe(true);
    expect(coordinator.isTerminal()).toBe(true);

    hidden = false;
    coordinator.onVisibilityChange();
    expect(paused).toBe(true);
  });

  it("enters terminal state when the second blur report fails", async () => {
    let hidden = false;
    let now = 0;
    let paused = true;
    let recoveryFailed = false;
    const deferred: DeferredAppend[] = [];
    let call = 0;

    const coordinator = createTrainingBlurCoordinator({
      appendEvent: async () => {
        call += 1;
        if (call === 1) {
          return blurResult();
        }
        const next = createDeferredAppend();
        deferred.push(next);
        return next.promise;
      },
      setPaused: (value) => {
        paused = value;
      },
      onAbandoned: () => undefined,
      onRecoveryFailed: () => {
        recoveryFailed = true;
      },
      isDocumentHidden: () => hidden,
      now: () => now,
    });

    hidden = true;
    now = 0;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 40;
    coordinator.onVisibilityChange();

    hidden = true;
    now = 100;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 160;
    coordinator.onVisibilityChange();
    await Promise.resolve();

    deferred[0]!.reject(new Error("network"));
    await expect(deferred[0]!.promise).rejects.toThrow("network");

    expect(recoveryFailed).toBe(true);
    expect(coordinator.isTerminal()).toBe(true);
    expect(paused).toBe(true);
  });

  it("queues blur intervals that arrive while a report is in flight", async () => {
    let hidden = false;
    let now = 0;
    const reported: number[] = [];
    const deferred: DeferredAppend[] = [];

    const coordinator = createTrainingBlurCoordinator({
      appendEvent: async (_eventType, payload) => {
        const next = createDeferredAppend();
        deferred.push(next);
        const result = await next.promise;
        reported.push(payload.durationMs as number);
        return result;
      },
      setPaused: vi.fn(),
      onAbandoned: vi.fn(),
      onRecoveryFailed: vi.fn(),
      isDocumentHidden: () => hidden,
      now: () => now,
    });

    hidden = true;
    now = 0;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 60;
    coordinator.onVisibilityChange();

    hidden = true;
    now = 70;
    coordinator.onVisibilityChange();
    hidden = false;
    now = 110;
    coordinator.onVisibilityChange();

    expect(coordinator.getPendingCount()).toBe(1);
    expect(coordinator.isReporting()).toBe(true);

    deferred[0]!.resolve(blurResult());
    await deferred[0]!.promise;
    await waitForDeferred(deferred, 1);
    deferred[1]!.resolve(blurResult());
    await deferred[1]!.promise;
    await flushMicrotasks();

    expect(reported).toEqual([60, 40]);
  });
});
