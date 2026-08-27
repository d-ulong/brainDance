import { ZodError } from "zod";

import { toErrorResponse } from "@/lib/http-errors";
import { ScheduleError, type ScheduleErrorCode } from "@/modules/schedule/errors";
import { SettlementError, type SettlementErrorCode } from "@/modules/settlement/errors";

export type M2ErrorBody = {
  error: {
    code?: string;
    message: string;
  };
};

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

function flatToNested(body: { error: string; code?: string }): M2ErrorBody {
  return {
    error: {
      code: body.code,
      message: body.error,
    },
  };
}

export function toRouteErrorResponse(error: unknown): {
  status: number;
  body: M2ErrorBody;
} {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { error: { code: "VALIDATION_ERROR", message: "Validation failed" } },
    };
  }

  if (error instanceof ScheduleError) {
    return {
      status: scheduleErrorToStatus(error.code),
      body: { error: { code: error.code, message: error.message } },
    };
  }

  if (error instanceof SettlementError) {
    return {
      status: settlementErrorToStatus(error.code),
      body: { error: { code: error.code, message: error.message } },
    };
  }

  const { status, body } = toErrorResponse(error);
  return { status, body: flatToNested(body) };
}
