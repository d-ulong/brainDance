"use client";

import { useCallback, useEffect, useState } from "react";

import {
  formatAgeBand,
  formatMetricLabel,
  formatMetricValue,
  formatSegmentReason,
} from "@/components/training/metric-labels";
import { Alert, LoadingState } from "@/components/ui/page-shell";
import { ApiError } from "@/lib/client/api";
import {
  fetchOwnTrainingTrends,
  fetchTrainingTrends,
  type TrainingKey,
  type SubjectTrainingTrendsResponse,
  type TrainingTrendsResponse,
  type TrendWindow,
} from "@/lib/client/training-api";

const WINDOW_OPTIONS: Array<{ value: TrendWindow; label: string }> = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
];

type TrendsPanelProps =
  | {
      mode: "self";
      trainingKey: TrainingKey;
      testIdPrefix?: string;
    }
  | {
      mode?: "student";
      studentId: string;
      trainingKey: TrainingKey;
      testIdPrefix?: string;
    };

type TrendsViewModel = {
  hasData: boolean;
  partialCoverage: boolean;
  segments: TrainingTrendsResponse["segments"] | SubjectTrainingTrendsResponse["segments"];
};

export function TrendsPanel(props: TrendsPanelProps) {
  const { trainingKey, testIdPrefix = "trends" } = props;
  const mode = props.mode === "self" ? "self" : "student";
  const studentId = props.mode === "self" ? null : props.studentId;
  const [window, setWindow] = useState<TrendWindow>("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trends, setTrends] = useState<TrendsViewModel | null>(null);

  const loadTrends = useCallback(
    async (selectedWindow: TrendWindow) => {
      setLoading(true);
      setError(null);
      try {
        if (mode === "self") {
          const data = await fetchOwnTrainingTrends(trainingKey, selectedWindow);
          setTrends(data);
        } else {
          const data = await fetchTrainingTrends(studentId!, trainingKey, selectedWindow);
          setTrends(data);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "无法加载趋势");
        setTrends(null);
      } finally {
        setLoading(false);
      }
    },
    [mode, studentId, trainingKey],
  );

  useEffect(() => {
    void loadTrends(window);
  }, [loadTrends, window]);

  return (
    <section
      className="rounded-xl border border-neutral-300 bg-white p-4"
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">个人趋势</h2>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="趋势时间窗口">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={window === option.value}
              data-testid={`${testIdPrefix}-window-${option.value}`}
              onClick={() => setWindow(option.value)}
              className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-1 ${
                window === option.value
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <LoadingState label="加载趋势…" /> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {!loading && !error && trends ? (
        <div className="flex flex-col gap-4">
          {!trends.hasData ? (
            <Alert tone="info" data-testid={`${testIdPrefix}-no-data`}>
              当前窗口内暂无有效训练记录。
            </Alert>
          ) : null}

          {trends.partialCoverage ? (
            <Alert tone="info" data-testid={`${testIdPrefix}-partial-coverage`}>
              部分历史超出当前窗口，仅展示窗口内有效训练点；跨段之间不可直接比较。
            </Alert>
          ) : null}

          {trends.segments.map((segment, segmentIndex) => (
            <div
              key={`${segment.definitionVersion}-${segment.ageBand}-${segmentIndex}`}
              className="rounded-lg border border-neutral-200 p-3"
              data-testid={`${testIdPrefix}-segment-${segmentIndex}`}
            >
              <p className="text-xs text-neutral-600">
                版本 {segment.definitionVersion} · {formatAgeBand(segment.ageBand)} ·{" "}
                {formatSegmentReason(segment.segmentReason)}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                本段包含 {segment.points.length} 次有效训练；不同段之间不连接、不比较。
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {segment.points.map((point) => (
                  <li
                    key={point.sessionId}
                    className="rounded-md bg-neutral-50 px-3 py-2 text-xs"
                    data-testid={`${testIdPrefix}-point-${point.sessionId.slice(0, 8)}`}
                  >
                    <p className="font-medium text-neutral-800">{point.familyDate}</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {point.metrics.slice(0, 4).map((metric) => (
                        <li key={metric.metricKey} className="flex justify-between gap-2">
                          <span>{formatMetricLabel(metric.metricKey)}</span>
                          <span>{formatMetricValue(metric.value, metric.unit)}</span>
                        </li>
                      ))}
                    </ul>
                    {point.digitSpanAttempts && point.digitSpanAttempts.length > 0 ? (
                      <p className="mt-1 text-neutral-500">
                        数字广度尝试 {point.digitSpanAttempts.length}{" "}
                        次（顺背/倒背摘要已纳入服务端记录）
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
