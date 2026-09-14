import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/db";
import { users, sessions, loginSecurityEvents } from "../src/db/schema";
import { hashPassword, verifyPassword, normalizeAccountKey } from "../src/lib/crypto";
import { appendAuditEvent } from "../src/modules/audit/append-audit-event";

config({ path: ".env.local" });

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/braindance_closed_pilot_20260903"
  ) {
    throw new Error("Refusing reset: an explicit loopback closed-pilot DATABASE_URL is required");
  }
  const db = getDb();
  const accounts = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users);
  console.log(
    JSON.stringify({
      database: url.pathname.slice(1),
      accountCount: accounts.length,
      roles: accounts.map((account) => account.role),
      mode: process.argv.includes("--apply") ? "apply" : "preview",
    }),
  );
  if (!process.argv.includes("--apply")) return;
  const password = process.env.LOCAL_RESET_PASSWORD;
  if (!password || password.length < 6)
    throw new Error("LOCAL_RESET_PASSWORD must be explicitly supplied");
  const admin = accounts.find(
    (account) => account.role === "admin" && account.status !== "disabled",
  );
  if (!admin) throw new Error("No active local administrator found");
  const operationId = randomUUID();
  await db.transaction(async (tx) => {
    const locked = await tx.select().from(users).orderBy(users.id).for("update");
    if (
      locked.length !== accounts.length ||
      locked.some((row) => !accounts.some((account) => account.id === row.id))
    )
      throw new Error("Account inventory changed; preview and retry");
    for (const account of locked) {
      const passwordHash = await hashPassword(password);
      await tx
        .update(users)
        .set({
          passwordHash,
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
          authorizationEpoch: sql`${users.authorizationEpoch} + 1`,
          lockedUntil: null,
          // One-time owner-authorized local convenience exception; never enables disabled users.
          mustChangePassword: false,
          status:
            account.status === "locked"
              ? account.role !== "parent" || account.contactVerifiedAt
                ? "active"
                : "pending_verification"
              : account.status,
        })
        .where(eq(users.id, account.id));
      await tx.delete(sessions).where(eq(sessions.userId, account.id));
      for (const key of new Set(
        [account.email, account.phone, account.username]
          .filter((value): value is string => Boolean(value))
          .map(normalizeAccountKey),
      )) {
        await tx
          .insert(loginSecurityEvents)
          .values({ accountKey: key, eventType: "account_unlocked" });
      }
      await appendAuditEvent(tx, {
        actorId: admin.id,
        action: "account.local_password_reset",
        resourceType: "user",
        resourceId: account.id,
        reasonCode: "owner_authorized_local_pilot",
        idempotencyKey: `local-reset:${operationId}:${account.id}`,
        metadata: { sessionsRevoked: true, localOnly: true },
      });
    }
  });
  const after = await db.select().from(users);
  for (const account of after)
    if (!(await verifyPassword(password, account.passwordHash)))
      throw new Error("Credential verification failed");
  console.log(JSON.stringify({ resetCount: after.length, credentialsVerified: true, operationId }));
}
main()
  .catch(() => {
    console.error(
      "Local password reset failed; no credentials are printed. Check the exact database, environment and account inventory.",
    );
    process.exitCode = 1;
  })
  .finally(closeDb);
