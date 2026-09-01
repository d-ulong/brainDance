import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exportJobs } from "@/db/schema";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { createExportJob, processExportJob } from "@/modules/data-lifecycle/export-job.service";
import { seedStudentUser } from "../../helpers/family-access";
import { createTestArtifactStore } from "../../helpers/data-lifecycle";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

vi.mock("@/modules/audit/append-audit-event", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/audit/append-audit-event")>();
  return {
    ...actual,
    appendAuditEvent: vi.fn(async (tx, input) => {
      if (input.action === "export.ready") {
        throw new DataLifecycleError("STATE_CONFLICT", "Injected finalize audit failure");
      }
      return actual.appendAuditEvent(tx, input);
    }),
  };
});

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M6 P2 export finalize fault injection", () => {
  const db = getTestDb();
  const artifactStore = createTestArtifactStore();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
  });

  it("C06: finalize failure after put purges artifact and marks job failed", async () => {
    const student = await seedStudentUser(db, {
      username: `c06_fail_fin_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c06-fail-finalize",
    });

    await expect(
      processExportJob(db, { jobId: created.jobId, artifactStore }),
    ).rejects.toBeInstanceOf(DataLifecycleError);

    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);

    expect(job!.status).toBe("failed");
    expect(artifactStore.has(`export/${created.jobId}`)).toBe(false);
  });
});
