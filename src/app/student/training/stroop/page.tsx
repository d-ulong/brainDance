"use client";

import { StroopTrainingRunner } from "@/components/training/stroop-training-runner";
import { STUDENT_TRAINING_LIFECYCLE } from "@/components/training/use-training-session-lifecycle";

export default function StroopTrainingPage() {
  return <StroopTrainingRunner lifecycleOptions={STUDENT_TRAINING_LIFECYCLE} />;
}
