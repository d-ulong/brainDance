import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { goalAssignments, users } from "@/db/schema";
import { closeIsolatedM2Database, openIsolatedM2Database, type IsolatedM2Database } from "./m2-isolated-database";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("goal completed migration constraints", () => {
  let isolated: IsolatedM2Database;

  beforeAll(async () => {
    isolated = await openIsolatedM2Database();
  });
  afterAll(async () => {
    if (isolated) await closeIsolatedM2Database(isolated);
  });

  async function insertAssignment(values: {
    status: string;
    completedBy?: string | null;
    completedAt?: Date | null;
    evaluatedBy?: string | null;
    evaluatedAt?: Date | null;
  }) {
    const db = isolated.db;
    const [student] = await db
      .insert(users)
      .values({
        role: "student",
        displayName: "约束学生",
        username: `gc_${Math.random().toString(36).slice(2, 8)}`,
        passwordHash: "test",
        status: "active",
        mustChangePassword: false,
      })
      .returning({ id: users.id });
    const [parent] = await db
      .insert(users)
      .values({
        role: "parent",
        displayName: "约束家长",
        email: `gc_${Math.random().toString(36).slice(2, 8)}@test.local`,
        passwordHash: "test",
        contactVerifiedAt: new Date(),
        status: "active",
      })
      .returning({ id: users.id });
    const definitionId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO goal_definitions (id, creator_id, source, content, due_date, horizon)
      VALUES (${definitionId}::uuid, ${parent!.id}::uuid, 'parent', 'test', '2026-12-01', 'medium')
    `);
    const assignmentId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO goal_assignments (
        id, definition_id, subject_id, responsible_parent_id, status,
        completed_by, completed_at, evaluated_by, evaluated_at
      ) VALUES (
        ${assignmentId}::uuid,
        ${definitionId}::uuid,
        ${student!.id}::uuid,
        ${parent!.id}::uuid,
        ${values.status},
        ${values.completedBy ?? null}::uuid,
        ${values.completedAt ? values.completedAt.toISOString() : null},
        ${values.evaluatedBy ?? null}::uuid,
        ${values.evaluatedAt ? values.evaluatedAt.toISOString() : null}
      )
    `);
    return assignmentId;
  }

  it("accepts legacy terminal rows without completion facts", async () => {
    const db = isolated.db;
    const [parent] = await db
      .insert(users)
      .values({
        role: "parent",
        displayName: "遗留家长",
        email: `legacy_${Math.random()}@test.local`,
        passwordHash: "test",
        contactVerifiedAt: new Date(),
        status: "active",
      })
      .returning({ id: users.id });
    const assignmentId = await insertAssignment({
      status: "succeeded",
      evaluatedBy: parent!.id,
      evaluatedAt: new Date(),
      completedBy: null,
      completedAt: null,
    });
    const [row] = await db
      .select({ status: goalAssignments.status })
      .from(goalAssignments)
      .where(eq(goalAssignments.id, assignmentId));
    expect(row?.status).toBe("succeeded");
  });

  it("rejects succeeded rows with only completed_by", async () => {
    const db = isolated.db;
    const [parent] = await db
      .insert(users)
      .values({
        role: "parent",
        displayName: "半填家长",
        email: `half_parent_${Math.random()}@test.local`,
        passwordHash: "test",
        contactVerifiedAt: new Date(),
        status: "active",
      })
      .returning({ id: users.id });
    await expect(
      insertAssignment({
        status: "succeeded",
        evaluatedBy: parent!.id,
        evaluatedAt: new Date(),
        completedBy: parent!.id,
        completedAt: null,
      }),
    ).rejects.toThrow();
  });

  it("rejects succeeded rows with only completed_at", async () => {
    const db = isolated.db;
    const [parent] = await db
      .insert(users)
      .values({
        role: "parent",
        displayName: "半填家长2",
        email: `half_parent2_${Math.random()}@test.local`,
        passwordHash: "test",
        contactVerifiedAt: new Date(),
        status: "active",
      })
      .returning({ id: users.id });
    await expect(
      insertAssignment({
        status: "succeeded",
        evaluatedBy: parent!.id,
        evaluatedAt: new Date(),
        completedBy: null,
        completedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("rejects half-populated completion pairs", async () => {
    const db = isolated.db;
    const [student] = await db
      .insert(users)
      .values({
        role: "student",
        displayName: "半填学生",
        username: `half_${Math.random().toString(36).slice(2, 8)}`,
        passwordHash: "test",
        status: "active",
        mustChangePassword: false,
      })
      .returning({ id: users.id });
    await expect(
      insertAssignment({
        status: "completed",
        completedBy: student!.id,
        completedAt: null,
      }),
    ).rejects.toThrow();
  });
});
