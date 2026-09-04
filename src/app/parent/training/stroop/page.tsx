"use client";

import { StroopTrainingRunner } from "@/components/training/stroop-training-runner";
import { PARENT_TRAINING_LIFECYCLE } from "@/components/training/use-training-session-lifecycle";

export default function ParentStroopTrainingPage() {
  return <StroopTrainingRunner lifecycleOptions={PARENT_TRAINING_LIFECYCLE} />;
}
