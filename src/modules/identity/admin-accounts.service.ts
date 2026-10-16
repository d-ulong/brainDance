import { randomInt } from "node:crypto";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { auditEvents, sessions, users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { requireAccountAdministrator } from "@/modules/identity/credential-session";
import { IdentityError } from "@/modules/identity/errors";
import { assertProductPassword } from "@/modules/identity/password-policy";

export const accountListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  role: z.enum(["admin", "parent", "student"]).optional(),
});
export const resetAccountSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  expectedAuthorizationEpoch: z.number().int().min(0).max(2147483646),
});

export async function listAccounts(
  db: Database,
  input: {
    adminId: string;
    currentSessionId: string;
  } & z.input<typeof accountListSchema>,
) {
  const query = accountListSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.adminId}::uuid FOR SHARE`);
    await requireAccountAdministrator(tx, input.adminId, input.currentSessionId);
    // Treat search as literal text, not SQL wildcard syntax.
    const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    const where = and(
      query.role ? eq(users.role, query.role) : undefined,
      query.search
        ? or(
            ilike(users.email, pattern),
            ilike(users.phone, pattern),
            ilike(users.username, pattern),
            ilike(users.displayName, pattern),
          )
        : undefined,
    );
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(where);
    const items = await tx
      .select({
        userId: users.id,
        account: sql<string>`coalesce(${users.username}, ${users.email}, ${users.phone}, '')`,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        authorizationEpoch: users.authorizationEpoch,
      })
      .from(users)
      .where(where)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { items, total: count.total, page: query.page, pageSize: query.pageSize };
  });
}

function temporaryPassword() {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789"];
  const chars = groups.map((group) => group[randomInt(group.length)]);
  const alphabet = groups.join("");
  while (chars.length < 12) chars.push(alphabet[randomInt(alphabet.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export type ResetAccountResult = {
  userId: string;
  mustChangePassword: true;
  authorizationEpoch: number;
  idempotentReplay: boolean;
  temporaryPassword?: string;
};

export async function resetAccountPassword(
  db: Database,
  input: {
    adminId: string;
    currentSessionId: string;
    userId: string;
    requestId?: string;
  } & z.infer<typeof resetAccountSchema>,
): Promise<ResetAccountResult> {
  resetAccountSchema.parse(input);
  input = {
    ...input,
    adminId: z.string().uuid().parse(input.adminId).toLowerCase(),
    userId: z.string().uuid().parse(input.userId).toLowerCase(),
  };
  if (input.adminId === input.userId) {
    throw new IdentityError("FORBIDDEN", "请通过修改密码处理本人账号");
  }
  const key = `audit:admin-reset:${input.adminId}:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    // Stable lock order prevents two administrators resetting one another from deadlocking.
    for (const id of [input.adminId, input.userId].sort()) {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`);
    }
    await requireAccountAdministrator(tx, input.adminId, input.currentSessionId);
    const [existing] = await tx
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, key))
      .limit(1);
    if (existing) {
      if (
        existing.resourceId !== input.userId ||
        existing.metadata?.expectedEpoch !== input.expectedAuthorizationEpoch
      ) {
        throw new IdentityError("IDEMPOTENCY_CONFLICT", "此操作标识已用于不同的重置请求");
      }
      return {
        userId: input.userId,
        mustChangePassword: true,
        authorizationEpoch: Number(existing.metadata?.resultEpoch),
        idempotentReplay: true,
      };
    }
    const [target] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) throw new IdentityError("USER_NOT_FOUND", "账号不存在");
    if (target.authorizationEpoch !== input.expectedAuthorizationEpoch) {
      throw new IdentityError("STATE_CONFLICT", "账号状态已变化，请刷新列表后重新操作");
    }
    const plain = temporaryPassword();
    assertProductPassword(plain);
    const passwordHash = await hashPassword(plain);
    const now = new Date();
    const epoch = target.authorizationEpoch + 1;
    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: true,
        authorizationEpoch: epoch,
        updatedAt: now,
      })
      .where(eq(users.id, target.id));
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
    await appendAuditEvent(tx, {
      actorId: input.adminId,
      action: "auth.password_reset",
      resourceType: "user",
      resourceId: target.id,
      requestId: input.requestId,
      idempotencyKey: key,
      metadata: { expectedEpoch: input.expectedAuthorizationEpoch, resultEpoch: epoch },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "user",
      aggregateId: target.id,
      eventType: "auth.password_reset",
      dedupeKey: key,
      payload: { userId: target.id, authorizationEpoch: epoch },
    });
    return {
      userId: target.id,
      mustChangePassword: true,
      authorizationEpoch: epoch,
      idempotentReplay: false,
      temporaryPassword: plain,
    };
  });
}
