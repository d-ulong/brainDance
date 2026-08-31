export function isPostgresUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 6 && current && typeof current === "object"; i += 1) {
    if (current instanceof Error || typeof current === "object") {
      const record = current as Record<string, unknown>;
      const code = typeof record.code === "string" ? record.code : "";
      if (code === "23505") {
        return true;
      }
      const message = current instanceof Error ? current.message : String(current);
      if (message.includes("duplicate key") || message.includes("unique constraint")) {
        return true;
      }
    }
    current =
      current instanceof Error && "cause" in current
        ? (current as Error & { cause?: unknown }).cause
        : undefined;
  }
  return false;
}
