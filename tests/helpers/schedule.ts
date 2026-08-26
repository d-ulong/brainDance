import { sql } from "drizzle-orm";

import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "@/modules/family-access/relationship-request.service";

import type { TestDb } from "./db";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "./family-access";

const M2_TABLES = [
  "schedule_horizon_maintains",
  "point_balance_projection",
  "point_ledger_entries",
  "settlements",
  "point_rule_versions",
  "point_rules",
  "fact_versions",
  "schedule_events",
  "schedule_items",
  "plan_schedule_slots",
  "plan_versions",
  "plans",
  "goals",
] as const;

export async function resetScheduleTables(db: TestDb): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      ${sql.raw(M2_TABLES.join(", "))}
    RESTART IDENTITY CASCADE
  `);
}

export async function bootstrapParentStudentRelationship(db: TestDb) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
  const { studentId } = await seedStudentUser(db, {
    username: `student_${suffix}`,
    password: "StudentPass123!Student",
  });

  const code = await issueAssociationCode(db, {
    studentId,
    idempotencyKey: `issue-${suffix}`,
  });

  const request = await createRelationshipRequest(db, {
    parentId,
    associationCodePlaintext: code.codePlaintext,
    idempotencyKey: `req-${suffix}`,
  });

  await acceptRelationshipRequest(db, {
    studentId,
    requestId: request.requestId,
    idempotencyKey: `accept-${suffix}`,
  });

  return { parentId, studentId, suffix };
}

export const FIXED_NOW = new Date("2026-01-15T04:00:00.000Z");

export const DEFAULT_PLAN_BODY = {
  title: "Daily Study",
  description: "Read books",
  localTime: "20:00",
  startDate: "2026-01-01",
  endDate: null as string | null,
};
