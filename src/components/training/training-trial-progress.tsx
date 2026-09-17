"use client";

import React from "react";

export type TrialOutcome = "correct" | "incorrect" | null;

export function TrainingTrialProgress({
  total,
  currentIndex,
  outcomes,
}: {
  total: number;
  /** 0-based index of the trial currently in progress. */
  currentIndex: number;
  outcomes: TrialOutcome[];
}) {
  if (total <= 0) return null;

  const safeCurrent = Math.min(Math.max(currentIndex, 0), total - 1);
  const label = `第 ${safeCurrent + 1} / ${total} 次`;

  return (
    <section
      className="rounded-2xl border border-[var(--bd-border)] bg-white px-3 py-3"
      data-testid="training-trial-progress"
      aria-label={`训练进度 ${label}`}
    >
      <p className="text-sm font-semibold text-[var(--bd-primary)]">{label}</p>
      <ol className="mt-2 flex flex-wrap gap-1.5" aria-label="各次对错">
        {Array.from({ length: total }, (_, index) => {
          const outcome = outcomes[index] ?? null;
          const isCurrent = index === safeCurrent && outcome === null;
          const statusLabel =
            outcome === "correct"
              ? "对"
              : outcome === "incorrect"
                ? "错"
                : isCurrent
                  ? "进行中"
                  : "未做";
          return (
            <li key={index}>
              <span
                className={[
                  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-1.5 text-xs font-bold tabular-nums",
                  outcome === "correct"
                    ? "border-emerald-600 bg-emerald-100 text-emerald-800"
                    : outcome === "incorrect"
                      ? "border-rose-500 bg-rose-100 text-rose-800"
                      : isCurrent
                        ? "border-[var(--bd-primary)] bg-[color-mix(in_srgb,var(--bd-primary)_16%,white)] text-[var(--bd-primary)] ring-2 ring-[color-mix(in_srgb,var(--bd-primary)_35%,transparent)]"
                        : "border-neutral-300 bg-neutral-50 text-neutral-400",
                ].join(" ")}
                data-testid={`trial-marker-${index}`}
                data-status={outcome ?? (isCurrent ? "current" : "pending")}
                title={`第 ${index + 1} 次：${statusLabel}`}
                aria-label={`第 ${index + 1} 次：${statusLabel}`}
              >
                {outcome === "correct" ? "✓" : outcome === "incorrect" ? "✗" : index + 1}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
