"use client";

import { DigitSpanTrainingRunner } from "@/components/training/digit-span-training-runner";
import { PARENT_TRAINING_LIFECYCLE } from "@/components/training/use-training-session-lifecycle";

export default function ParentDigitSpanTrainingPage() {
  return <DigitSpanTrainingRunner lifecycleOptions={PARENT_TRAINING_LIFECYCLE} />;
}
