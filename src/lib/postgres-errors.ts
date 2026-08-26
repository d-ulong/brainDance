export function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  if (code === "23505") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("duplicate key") || message.includes("unique constraint");
}
