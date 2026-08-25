export type UserRole = "admin" | "parent" | "student";

export type UserStatus = "pending_verification" | "active" | "locked" | "disabled";

export const PARENT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const STUDENT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

export const OTP_TTL_MS = 10 * 60 * 1000;

export type AuditMetadata = Record<string, string | number | boolean | null>;
