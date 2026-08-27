export function newIdempotencyKey(prefix = "web"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

type ApiErrorBody = {
  error?: string | { code?: string; message: string };
  code?: string;
};

function parseApiErrorBody(body: ApiErrorBody): { message: string; code?: string } {
  if (typeof body.error === "object" && body.error !== null) {
    return { message: body.error.message, code: body.error.code };
  }
  return { message: body.error ?? "Request failed", code: body.code };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, body: ApiErrorBody) {
    const parsed = parseApiErrorBody(body);
    super(parsed.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = parsed.code;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body;
}

export async function apiLogout(): Promise<void> {
  await apiFetch("/api/auth/session", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: newIdempotencyKey("logout") }),
  });
}

export type SessionInfo = {
  userId: string;
  role: "admin" | "parent" | "student";
  contactVerified: boolean;
  status?: string;
  mustChangePassword?: boolean;
};

export async function fetchSession(): Promise<SessionInfo | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as SessionInfo;
}
