import { LOGIN_LOCK_DURATION_MS, MAX_LOGIN_FAILURES } from "./constants";

export function loginPolicy(env: NodeJS.ProcessEnv = process.env) {
  let local = false;
  try {
    const host = new URL(env.NEXT_PUBLIC_APP_URL ?? "").hostname;
    local =
      env.LOCAL_PILOT_MODE === "true" &&
      env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(host);
  } catch {
    /* Missing or invalid URL keeps the standard policy. */
  }
  return local
    ? { maxFailures: 10, lockDurationMs: 60_000 }
    : { maxFailures: MAX_LOGIN_FAILURES, lockDurationMs: LOGIN_LOCK_DURATION_MS };
}
