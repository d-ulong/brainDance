"use client";

import type { TrainingTrialReviewDto } from "@/lib/client/training-api";

function ReactionRow({ trial }: { trial: Extract<TrainingTrialReviewDto, { kind: "reaction" }> }) {
  return (
    <article className="bd-training-review-row rounded-2xl border border-[var(--bd-border)] p-3 text-sm">
      <p className="font-semibold">第 {trial.trialIndex + 1} 题</p>
      <dl className="mt-2 grid gap-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">刺激</dt>
          <dd>{trial.prompt}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">期望动作</dt>
          <dd>{trial.expectedAction}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">我的作答</dt>
          <dd>{trial.actualAction ?? "未响应"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">是否正确</dt>
          <dd>{trial.correct ? "正确" : "错误"}</dd>
        </div>
        {trial.reactionMs !== null ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-[var(--bd-muted)]">反应时间</dt>
            <dd>{Math.round(trial.reactionMs)} ms</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function StroopRow({ trial }: { trial: Extract<TrainingTrialReviewDto, { kind: "stroop" }> }) {
  return (
    <article className="bd-training-review-row rounded-2xl border border-[var(--bd-border)] p-3 text-sm">
      <p className="font-semibold">第 {trial.trialIndex + 1} 题</p>
      <dl className="mt-2 grid gap-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">题面</dt>
          <dd>
            {trial.word}（{trial.inkColor}色字）
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">正确颜色</dt>
          <dd>{trial.expectedColor}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">我的选择</dt>
          <dd>{trial.selectedColor ?? "未作答"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">是否正确</dt>
          <dd>{trial.correct ? "正确" : "错误"}</dd>
        </div>
      </dl>
    </article>
  );
}

function DigitSpanRow({
  trial,
}: {
  trial: Extract<TrainingTrialReviewDto, { kind: "digit-span" }>;
}) {
  return (
    <article className="bd-training-review-row rounded-2xl border border-[var(--bd-border)] p-3 text-sm">
      <p className="font-semibold">
        第 {trial.attemptIndex} 题 · {trial.ruleDirection}
      </p>
      <dl className="mt-2 grid gap-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">呈现序列</dt>
          <dd>{trial.presentedSequence}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">正确答案</dt>
          <dd>{trial.expectedSequence}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">我的输入</dt>
          <dd>{trial.submittedSequence ?? "未作答"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-[var(--bd-muted)]">是否正确</dt>
          <dd>{trial.correct ? "正确" : "错误"}</dd>
        </div>
      </dl>
    </article>
  );
}

export function TrainingSessionReview({ trials }: { trials: TrainingTrialReviewDto[] }) {
  if (!trials.length) {
    return <p className="text-sm text-[var(--bd-muted)]">暂无逐题明细。</p>;
  }
  return (
    <section className="space-y-3" data-testid="training-trial-review">
      <h2 className="text-sm font-semibold">逐题明细</h2>
      <div className="grid gap-2">
        {trials.map((trial, index) => {
          if (trial.kind === "reaction") {
            return <ReactionRow key={`reaction-${trial.trialIndex}`} trial={trial} />;
          }
          if (trial.kind === "stroop") {
            return <StroopRow key={`stroop-${trial.trialIndex}`} trial={trial} />;
          }
          return <DigitSpanRow key={`digit-${index}`} trial={trial} />;
        })}
      </div>
    </section>
  );
}
