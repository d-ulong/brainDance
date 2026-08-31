import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { trainingProfileProjection } from "@/db/schema";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import {
  loadTrainingProfileProjectionRows,
  projectionRowsEquivalent,
  rebuildTrainingProfileProjectionForStudent,
} from "@/modules/training/trends.service";
import { seedStudentUser } from "../../helpers/family-access";
import { completeReactionSession, ensureM5TrainingDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M5 training projection rebuild", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await ensureM5TrainingDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("AC-M5-06: repeat rebuild is idempotent", async () => {
    const student = await seedStudentUser(db, {
      username: `rebuild_idem_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-idem-1",
      submitIdempotencyKey: "rebuild-idem-1-submit",
    });
    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-idem-2",
      submitIdempotencyKey: "rebuild-idem-2-submit",
    });

    const baseline = await loadTrainingProfileProjectionRows(db, student.studentId);

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });
    const firstRebuild = await loadTrainingProfileProjectionRows(db, student.studentId);

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });
    const secondRebuild = await loadTrainingProfileProjectionRows(db, student.studentId);

    expect(
      projectionRowsEquivalent(
        baseline.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
        firstRebuild.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
      ),
    ).toBe(true);
    expect(
      projectionRowsEquivalent(
        firstRebuild.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
        secondRebuild.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
      ),
    ).toBe(true);
  });

  it("AC-M5-06: rebuild removes stale projection rows for inactive training keys", async () => {
    const student = await seedStudentUser(db, {
      username: `rebuild_stale_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-stale-start",
      submitIdempotencyKey: "rebuild-stale-submit",
    });

    await db.insert(trainingProfileProjection).values({
      studentId: student.studentId,
      trainingKey: "legacy_training",
      definitionVersion: 1,
      ageBand: "9-12",
      metricKey: "accuracy",
      bestValue: "1.000000",
      lastValue: "1.000000",
    });

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });

    const rows = await loadTrainingProfileProjectionRows(db, student.studentId);
    expect(rows.every((row) => row.trainingKey === REACTION_TRAINING_KEY)).toBe(true);
    expect(rows.some((row) => row.metricKey === "accuracy")).toBe(true);
  });
});
