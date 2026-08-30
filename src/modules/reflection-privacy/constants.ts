export const PRIVATE_RESOURCE_TYPES = {
  DAILY_REFLECTION: "daily_reflection",
} as const;

export type PrivateResourceType =
  (typeof PRIVATE_RESOURCE_TYPES)[keyof typeof PRIVATE_RESOURCE_TYPES];

export type ReflectionVisibility = "normal" | "private";
