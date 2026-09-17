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
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body && !headers.has("Content-Type") && !isFormData) {
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

export type SessionInfo = {
  userId: string;
  displayName?: string;
  account?: string;
  role: "admin" | "parent" | "student";
  contactVerified: boolean;
  status?: string;
  mustChangePassword?: boolean;
};

type SessionCache = {
  value: SessionInfo | null;
  at: number;
};

const SESSION_CACHE_TTL_MS = 30_000;
let sessionCache: SessionCache | null = null;
let sessionInflight: Promise<SessionInfo | null> | null = null;

export function clearSessionCache() {
  sessionCache = null;
  sessionInflight = null;
}

export async function fetchSession(options?: { force?: boolean }): Promise<SessionInfo | null> {
  const force = options?.force === true;
  if (!force && sessionCache && Date.now() - sessionCache.at < SESSION_CACHE_TTL_MS) {
    return sessionCache.value;
  }
  if (!force && sessionInflight) {
    return sessionInflight;
  }

  sessionInflight = (async () => {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    let value: SessionInfo | null = null;
    if (response.status !== 401 && response.ok) {
      value = (await response.json()) as SessionInfo;
    }
    sessionCache = { value, at: Date.now() };
    sessionInflight = null;
    return value;
  })();

  return sessionInflight;
}

export async function apiLogout(): Promise<void> {
  try {
    await apiFetch("/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: newIdempotencyKey("logout") }),
    });
  } finally {
    clearSessionCache();
  }
}
