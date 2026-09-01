import { existsSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureM6OutboxArtifactStore } from "@/modules/data-lifecycle/m6-outbox-handlers";
import {
  createExportJob,
  getExportJobStatusForActor,
  issueExportDownloadToken,
} from "@/modules/data-lifecycle/export-job.service";
import { createMemoryArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";
import { processNextOutboxEvent } from "@/modules/outbox/process-outbox-event.service";

import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { resetScheduleTables } from "../../helpers/schedule";
import { resetRedemptionTables } from "../../helpers/redemption";
import { bootstrapParentStudentRelationship } from "../../helpers/schedule";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("m6 export worker boundary", () => {
  const db = getTestDb();
  const artifactStore = createMemoryArtifactStore();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    configureM6OutboxArtifactStore(() => artifactStore);
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetScheduleTables(db);
    await resetRedemptionTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("C01: process route file is removed (browser cannot trigger worker)", () => {
    const routePath = path.join(
      process.cwd(),
      "src",
      "app",
      "api",
      "export-jobs",
      "[jobId]",
      "process",
      "route.ts",
    );
    expect(existsSync(routePath)).toBe(false);
  });

  it("C01: worker processes export.requested and status never reveals a token", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    const created = await createExportJob(db, {
      requesterId: studentId,
      requesterRole: "student",
      studentId,
      idempotencyKey: `c01-export-${Date.now()}`,
    });
    expect(created.status).toBe("pending");

    let ready = false;
    for (let i = 0; i < 30; i += 1) {
      const result = await processNextOutboxEvent(db, {
        workerId: `c01-worker-${Date.now()}-${i}`,
      });

      const status = await getExportJobStatusForActor(db, created.jobId, {
        actorId: studentId,
        actorRole: "student",
      });
      if (status.status === "ready") {
        // The status payload must not contain any token plaintext (F01).
        expect(status).not.toHaveProperty("downloadTokenPlaintext");
        ready = true;
        break;
      }

      if (!result.processed) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    expect(ready).toBe(true);

    // The token is obtained only through the authorization-gated issuance command.
    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: studentId, actorRole: "student" },
    });
    expect(issued.token).toBeTruthy();
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
