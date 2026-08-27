import { ZodError } from "zod";

import { toErrorResponse } from "@/lib/http-errors";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { IdentityError } from "@/modules/identity/errors";
import { ScheduleError, type ScheduleErrorCode } from "@/modules/schedule/errors";
import { SettlementError, type SettlementErrorCode } from "@/modules/settlement/errors";
import { TrainingError } from "@/modules/training/errors";

function scheduleErrorToStatus(code: ScheduleErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "IDEMPOTENCY_CONFLICT":
    case "STATE_CONFLICT":
    case "WINDOW_EXPIRED":
      return 409;
    case "SLOT_INVARIANT":
    default:
      return 500;
  }
}

function settlementErrorToStatus(code: SettlementErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "VALIDATION_ERROR":
      return 400;
    case "IDEMPOTENCY_CONFLICT":
    case "STATE_CONFLICT":
    case "NO_ACTIVE_RULE":
      return 409;
    default:
      return 500;
  }
}

export function toRouteErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { error: "Validation failed", code: "VALIDATION_ERROR" },
    };
  }

  if (error instanceof ScheduleError) {
    return {
      status: scheduleErrorToStatus(error.code),
      body: { error: error.message, code: error.code },
    };
  }

  if (error instanceof SettlementError) {
    return {
      status: settlementErrorToStatus(error.code),
      body: { error: error.message, code: error.code },
    };
  }

  if (
    error instanceof IdentityError ||
    error instanceof FamilyAccessError ||
    error instanceof TrainingError
  ) {
    return toErrorResponse(error);
  }

  return {
    status: 500,
    body: { error: "Internal server error" },
  };
}
