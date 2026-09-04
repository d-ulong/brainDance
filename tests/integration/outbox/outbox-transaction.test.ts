import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { outboxEvents, relationships } from "@/db/schema";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "@/modules/family-access/relationship-request.service";
import { createInvitation } from "@/modules/identity/invitation.service";
import { registerParent } from "@/modules/identity/registration.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import { bootstrapAdmin } from "../../helpers/identity";
import { completeReactionSession, ensureReactionDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("outbox transaction", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await ensureReactionDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function countOutboxByDedupe(dedupeKey: string) {
    const rows = await db.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, dedupeKey));
    return rows.length;
  }

  it("writes outbox on invitation redemption during registration", async () => {
    const { adminId } = await bootstrapAdmin(db, `admin-${crypto.randomUUID()}@test.local`);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "outbox-invite",
    });

    await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Outbox Parent",
      email: `parent-${crypto.randomUUID()}@test.local`,
      password: "Parent1aXy",
      idempotencyKey: "register-outbox",
    });

    expect(await countOutboxByDedupe("outbox:invite-redeem:register-outbox")).toBe(1);
  });

  it("writes outbox on relationship acceptance", async () => {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-outbox",
    });
    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-outbox",
    });

    await acceptRelationshipRequest(db, {
      studentId: student.studentId,
      requestId: pending.requestId,
      idempotencyKey: "accept-outbox",
    });

    expect(await countOutboxByDedupe("outbox:rel-accept:accept-outbox")).toBe(1);
  });

  it("writes outbox on relationship end", async () => {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-end-outbox",
    });
    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-end-outbox",
    });
    const accepted = await acceptRelationshipRequest(db, {
      studentId: student.studentId,
      requestId: pending.requestId,
      idempotencyKey: "accept-end-outbox",
    });

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: accepted.relationshipId,
      idempotencyKey: "end-outbox",
    });

    expect(await countOutboxByDedupe("outbox:rel-end:end-outbox")).toBe(1);

    const [relationship] = await db
      .select()
      .from(relationships)
      .where(eq(relationships.id, accepted.relationshipId))
      .limit(1);
    expect(relationship?.status).toBe("ended");
  });

  it("writes outbox on training submit complete", async () => {
    const student = await seedStudentUser(db, {
      username: `student_train_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    await completeReactionSession(db, student.studentId, {
      submitIdempotencyKey: "submit-outbox",
    });

    expect(
      await countOutboxByDedupe(`outbox:training-complete:${student.studentId}:submit-outbox`),
    ).toBe(1);
  });

  it("deduplicates outbox writes by dedupe_key", async () => {
    const dedupeKey = "outbox:dedupe-test:once";

    await db.transaction(async (tx) => {
      await appendOutboxEvent(tx, {
        aggregateType: "test",
        aggregateId: crypto.randomUUID(),
        eventType: "test.event",
        dedupeKey,
        payload: { n: 1 },
      });
      await appendOutboxEvent(tx, {
        aggregateType: "test",
        aggregateId: crypto.randomUUID(),
        eventType: "test.event",
        dedupeKey,
        payload: { n: 2 },
      });
    });

    expect(await countOutboxByDedupe(dedupeKey)).toBe(1);
  });

  it("rolls back outbox rows when the transaction fails", async () => {
    const dedupeKey = "outbox:rollback-test";

    await expect(
      db.transaction(async (tx) => {
        await appendOutboxEvent(tx, {
          aggregateType: "test",
          aggregateId: crypto.randomUUID(),
          eventType: "test.event",
          dedupeKey,
          payload: { rollback: true },
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    expect(await countOutboxByDedupe(dedupeKey)).toBe(0);
  });

  it("stores version, aggregate identity, event type, and dedupe key on outbox rows", async () => {
    const { adminId } = await bootstrapAdmin(db, `admin-${crypto.randomUUID()}@test.local`);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "outbox-fields-invite",
    });
    const dedupeKey = "outbox:invite-redeem:register-fields";

    await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Outbox Fields Parent",
      email: `parent-fields-${crypto.randomUUID()}@test.local`,
      password: "Parent1aXy",
      idempotencyKey: "register-fields",
    });

    const [row] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, dedupeKey))
      .limit(1);

    expect(row).toBeTruthy();
    expect(row?.aggregateType).toBe("invitation");
    expect(row?.aggregateId).toBe(invite.invitationId);
    expect(row?.eventType).toBe("invitation.redeemed");
    expect(row?.eventVersion).toBe(1);
    expect(row?.dedupeKey).toBe(dedupeKey);
    expect(row?.status).toBe("pending");
    expect(row?.payload).toMatchObject({
      invitationId: invite.invitationId,
      targetRole: "parent",
    });
  });

  it("rolls back relationship end facts and outbox when the transaction fails", async () => {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-rollback-end",
    });
    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-rollback-end",
    });
    const accepted = await acceptRelationshipRequest(db, {
      studentId: student.studentId,
      requestId: pending.requestId,
      idempotencyKey: "accept-rollback-end",
    });

    const dedupeKey = "outbox:rel-end:rollback-end";

    await expect(
      db.transaction(async (tx) => {
        await endRelationship(tx, {
          actorId: parentId,
          relationshipId: accepted.relationshipId,
          idempotencyKey: "rollback-end",
        });
        throw new Error("force rollback after end");
      }),
    ).rejects.toThrow("force rollback after end");

    const [relationship] = await db
      .select()
      .from(relationships)
      .where(eq(relationships.id, accepted.relationshipId))
      .limit(1);
    expect(relationship?.status).toBe("active");
    expect(await countOutboxByDedupe(dedupeKey)).toBe(0);
  });
});
