export const EXPORT_JOB_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
  EXPIRED: "expired",
  REVOKED: "revoked",
} as const;

export const DELETION_TARGET_TYPE = {
  STUDENT_ACCOUNT: "student_account",
  DAILY_REFLECTION: "daily_reflection",
} as const;

export const DELETION_STATUS = {
  REQUESTED: "requested",
  FROZEN: "frozen",
  CANCELLED: "cancelled",
  EXECUTED: "executed",
} as const;

export const EXPORT_SCOPE_SCHEMA_VERSION = 1;
export const EXPORT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const DELETION_REVOCABLE_DAYS = 30;

export const DELETION_STEP = {
  REVOKE_SESSIONS_ARTIFACTS: 1,
  STOP_FUTURE_SCHEDULE: 2,
  PURGE_BODIES: 3,
  MINIMIZE_IDENTITY: 4,
  CLEANUP_PROJECTIONS: 5,
  WRITE_TOMBSTONE: 6,
  MARK_EXECUTED: 7,
} as const;

export const EXPORT_SECTIONS = [
  "profile",
  "schedule",
  "ledger",
  "training_summary",
  "reflections",
  "redemptions",
] as const;

export type ExportScopeSnapshot = {
  schemaVersion: typeof EXPORT_SCOPE_SCHEMA_VERSION;
  requesterRole: "student" | "parent";
  studentId: string;
  authorizationEpoch: number;
  relationshipIds: string[];
  privateGrantIds: string[];
  includedSections: Array<(typeof EXPORT_SECTIONS)[number]>;
};
