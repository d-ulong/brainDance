"use client";

import { ReactionTrainingRunner } from "@/components/training/reaction-training-runner";
import { STUDENT_TRAINING_LIFECYCLE } from "@/components/training/use-training-session-lifecycle";

export default function ReactionTrainingPage() {
  return <ReactionTrainingRunner lifecycleOptions={STUDENT_TRAINING_LIFECYCLE} />;
}
