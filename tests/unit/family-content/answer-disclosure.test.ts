import { describe, expect, it } from "vitest";

import { isAnswerDisclosed } from "@/modules/family-content/answer-disclosure.service";

const publishedAt = new Date("2026-09-12T00:00:00.000Z");

describe("push answer disclosure", () => {
  it("keeps a student's own answer visible even while peer answers are private", () => {
    expect(isAnswerDisclosed({ id: "push-a", studentId: "student-a", publishedAt, answerDisclosureDays: 7 }, "student-a", new Date("2026-09-12T01:00:00.000Z"))).toBe(true);
    expect(isAnswerDisclosed({ id: "push-b", studentId: "student-b", publishedAt, answerDisclosureDays: 7 }, "student-a", new Date("2026-09-12T01:00:00.000Z"))).toBe(false);
  });

  it("makes peer answers public immediately when no delay is configured, or after the exact delay", () => {
    expect(isAnswerDisclosed({ id: "push-b", studentId: "student-b", publishedAt, answerDisclosureDays: null }, "student-a", new Date("2026-09-12T00:00:00.000Z"))).toBe(true);
    expect(isAnswerDisclosed({ id: "push-b", studentId: "student-b", publishedAt, answerDisclosureDays: 2 }, "student-a", new Date("2026-09-13T23:59:59.999Z"))).toBe(false);
    expect(isAnswerDisclosed({ id: "push-b", studentId: "student-b", publishedAt, answerDisclosureDays: 2 }, "student-a", new Date("2026-09-14T00:00:00.000Z"))).toBe(true);
  });
});
