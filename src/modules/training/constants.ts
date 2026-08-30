export const REACTION_TRAINING_KEY = "reaction";
export const STROOP_TRAINING_KEY = "stroop";
export const DIGIT_SPAN_TRAINING_KEY = "digit-span";

export const REACTION_CALCULATION_VERSION = "reaction-v1";
export const STROOP_CALCULATION_VERSION = "stroop-v1";
export const DIGIT_SPAN_CALCULATION_VERSION = "digit-span-v1";

/** Minimum reaction time included in median (ms). */
export const REACTION_MIN_VALID_MS = 100;
/** Maximum reaction time included in median (ms). */
export const REACTION_MAX_VALID_MS = 3000;

/** Abandon when cumulative blur exceeds this threshold (ms). */
export const TRAINING_BLUR_ABANDON_MS = 30_000;

export const DEFAULT_REACTION_TRIAL_COUNT = 5;

export const STROOP_COLORS = ["red", "blue", "green", "yellow"] as const;
export type StroopColor = (typeof STROOP_COLORS)[number];
