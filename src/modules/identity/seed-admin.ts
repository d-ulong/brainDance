import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";

export async function seedAdminUser(
  db: Database,
  input: {
    email: string;
    password: string;
    displayName?: string;
  },
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return existing.id;
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const [created] = await db
    .insert(users)
    .values({
      role: "admin",
      displayName: input.displayName ?? "Administrator",
      email,
      passwordHash,
      status: "active",
      contactVerifiedAt: now,
    })
    .returning({ id: users.id });

  if (!created) {
    throw new Error("Failed to seed admin user");
  }

  return created.id;
}
