export const REACTION_TRAINING_KEY = "reaction";
export const REACTION_CALCULATION_VERSION = "reaction-v1";

/** Minimum reaction time included in median (ms). */
export const REACTION_MIN_VALID_MS = 100;
/** Maximum reaction time included in median (ms). */
export const REACTION_MAX_VALID_MS = 3000;

/** Abandon when cumulative blur exceeds this threshold (ms). */
export const TRAINING_BLUR_ABANDON_MS = 30_000;

export const DEFAULT_REACTION_TRIAL_COUNT = 5;
