import { describe, expect, it } from "vitest";

import { isTopModalLayer, registerModalLayer } from "@/components/ui/modal-layer";

describe("modal layer registry", () => {
  it("only treats the latest registration as topmost", () => {
    const first = Symbol("first");
    const second = Symbol("second");
    const disposeFirst = registerModalLayer(first);
    registerModalLayer(second);
    expect(isTopModalLayer(first)).toBe(false);
    expect(isTopModalLayer(second)).toBe(true);
    disposeFirst();
    expect(isTopModalLayer(second)).toBe(true);
  });
});
