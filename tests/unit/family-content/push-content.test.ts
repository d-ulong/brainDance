import { describe, expect, it } from "vitest";
import { normalizePushContent } from "@/modules/family-content/content";
import { classifyVideoUrl } from "@/lib/client/video-url";

describe("push content presentation", () => {
  it("accepts up to five distinct images and rejects a sixth", () => {
    expect(normalizePushContent({ mediaIds: ["1", "2", "3", "4", "5"] }).mediaIds).toHaveLength(5);
    expect(() => normalizePushContent({ mediaIds: ["1", "2", "3", "4", "5", "6"] })).toThrow(/at most 5/i);
  });
  it("embeds only recognized video links", () => {
    expect(classifyVideoUrl("https://example.com/movie.mp4")).toMatchObject({ kind: "direct" });
    expect(classifyVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD")).toMatchObject({ kind: "embed", provider: "哔哩哔哩" });
    expect(classifyVideoUrl("https://example.com/article")).toBeNull();
  });
});
