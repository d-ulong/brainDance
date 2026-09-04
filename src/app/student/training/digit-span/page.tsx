"use client";

import { DigitSpanTrainingRunner } from "@/components/training/digit-span-training-runner";
import { STUDENT_TRAINING_LIFECYCLE } from "@/components/training/use-training-session-lifecycle";

export default function DigitSpanTrainingPage() {
  return <DigitSpanTrainingRunner lifecycleOptions={STUDENT_TRAINING_LIFECYCLE} />;
}
