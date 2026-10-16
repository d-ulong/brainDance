import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSessionCache, fetchSession } from "@/lib/client/api";

afterEach(() => {
  clearSessionCache();
  vi.unstubAllGlobals();
});

describe("session request recovery", () => {
  it("retries after network failure without treating it as logout", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: "student", role: "student" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchSession()).rejects.toThrow("network");
    await expect(fetchSession()).resolves.toMatchObject({ userId: "student" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache temporary service failure as unauthenticated", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchSession()).rejects.toMatchObject({ status: 503 });
    await expect(fetchSession()).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("prevents an old request from overwriting a forced refresh", async () => {
    let finishOld!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: "fresh" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const old = fetchSession();
    await fetchSession({ force: true });
    finishOld(new Response(JSON.stringify({ userId: "stale" }), { status: 200 }));
    await old;
    await expect(fetchSession()).resolves.toMatchObject({ userId: "fresh" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
