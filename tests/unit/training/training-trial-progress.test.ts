import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TrainingTrialProgress } from "@/components/training/training-trial-progress";

describe("TrainingTrialProgress", () => {
  it("marks completed trials and keeps remaining pending", () => {
    const html = renderToStaticMarkup(
      createElement(TrainingTrialProgress, {
        total: 4,
        currentIndex: 2,
        outcomes: ["correct", "incorrect", null, null],
      }),
    );

    expect(html).toContain("第 3 / 4 次");
    expect(html).toContain('data-status="correct"');
    expect(html).toContain('data-status="incorrect"');
    expect(html).toContain('data-status="current"');
    expect(html).toContain('data-status="pending"');
  });
});
