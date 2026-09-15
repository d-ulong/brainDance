"use client";

import { useState } from "react";

import {
  compactFamilyDates,
  formatCompactDateSegments,
  truncateSegments,
} from "@/modules/schedule/compact-family-dates";

export function CompactGeneratedDates({
  dates,
  initialLimit = 3,
}: {
  dates: string[];
  initialLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!dates.length) {
    return <span data-testid="generated-dates-empty">尚未生成</span>;
  }
  const segments = compactFamilyDates(dates);
  const { visible, hidden, truncated } = truncateSegments(
    segments,
    expanded ? segments.length : initialLimit,
  );
  const labels = formatCompactDateSegments(visible);
  return (
    <span data-testid="generated-dates">
      {labels.join("、")}
      {truncated ? (
        <>
          {" "}
          <button
            type="button"
            className="font-semibold text-[var(--bd-primary)] underline"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起" : `展开全部（还有 ${hidden} 段）`}
          </button>
        </>
      ) : null}
    </span>
  );
}
