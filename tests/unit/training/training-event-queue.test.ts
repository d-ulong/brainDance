import { describe, expect, it, vi } from "vitest";

import { createTrainingEventQueue } from "@/components/training/training-event-queue";

describe("createTrainingEventQueue", () => {
  it("runs append tasks strictly in order with no sequence overlap", async () => {
    const queue = createTrainingEventQueue<number>();
    const order: string[] = [];

    const first = queue.enqueue(async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("first-end");
      return 1;
    });

    const second = queue.enqueue(async () => {
      order.push("second-start");
      return 2;
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("does not advance later tasks when an earlier task rejects", async () => {
    const queue = createTrainingEventQueue<void>();
    const ran: string[] = [];

    const failing = queue.enqueue(async () => {
      ran.push("fail");
      throw new Error("append failed");
    });

    const following = queue.enqueue(async () => {
      ran.push("follow");
    });

    await expect(failing).rejects.toThrow("append failed");
    await following;
    expect(ran).toEqual(["fail", "follow"]);
  });

  it("serializes concurrent enqueue calls", async () => {
    const queue = createTrainingEventQueue<number>();
    let active = 0;
    let maxActive = 0;

    const task = async (label: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return label;
    };

    await Promise.all([
      queue.enqueue(() => task(1)),
      queue.enqueue(() => task(2)),
      queue.enqueue(() => task(3)),
    ]);

    expect(maxActive).toBe(1);
  });

  it("propagates rejection without blocking subsequent tasks", async () => {
    const queue = createTrainingEventQueue<number>();
    const append = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(42);

    await expect(
      queue.enqueue(async () => {
        return append();
      }),
    ).rejects.toThrow("network");

    await expect(
      queue.enqueue(async () => {
        return append();
      }),
    ).resolves.toBe(42);

    expect(append).toHaveBeenCalledTimes(2);
  });
});
