export type CompactDateSegment =
  | { kind: "single"; date: string }
  | { kind: "range"; from: string; to: string };

/** Compact sorted unique YYYY-MM-DD family dates into contiguous inclusive ranges. */
export function compactFamilyDates(dates: string[]): CompactDateSegment[] {
  const unique = [...new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  if (!unique.length) return [];

  const segments: CompactDateSegment[] = [];
  let from = unique[0]!;
  let to = unique[0]!;

  for (let index = 1; index < unique.length; index += 1) {
    const current = unique[index]!;
    if (isNextCalendarDay(to, current)) {
      to = current;
      continue;
    }
    segments.push(from === to ? { kind: "single", date: from } : { kind: "range", from, to });
    from = current;
    to = current;
  }
  segments.push(from === to ? { kind: "single", date: from } : { kind: "range", from, to });
  return segments;
}

export function formatCompactDateSegments(segments: CompactDateSegment[]): string[] {
  return segments.map((segment) =>
    segment.kind === "single" ? segment.date : `${segment.from} 至 ${segment.to}`,
  );
}

export function truncateSegments(
  segments: CompactDateSegment[],
  limit: number,
): { visible: CompactDateSegment[]; hidden: number; truncated: boolean } {
  if (limit < 1 || segments.length <= limit) {
    return { visible: segments, hidden: 0, truncated: false };
  }
  return {
    visible: segments.slice(0, limit),
    hidden: segments.length - limit,
    truncated: true,
  };
}

function isNextCalendarDay(previous: string, next: string): boolean {
  const cursor = new Date(`${previous}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10) === next;
}
