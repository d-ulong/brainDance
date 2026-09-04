"use client";

import { ReactionTrainingRunner } from "@/components/training/reaction-training-runner";
import { PARENT_TRAINING_LIFECYCLE } from "@/components/training/use-training-session-lifecycle";

export default function ParentReactionTrainingPage() {
  return <ReactionTrainingRunner lifecycleOptions={PARENT_TRAINING_LIFECYCLE} />;
}
