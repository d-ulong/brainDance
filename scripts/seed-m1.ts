import { config } from "dotenv";

import { createDb, closeDb } from "../src/db";
import { requireDatabaseUrl } from "../src/lib/env";
import { seedM5TrainingDefinitions } from "../src/modules/training/definition.service";
import { seedAdminUser } from "../src/modules/identity/seed-admin";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const connectionString = requireDatabaseUrl();
  const db = createDb(connectionString);

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@local.braindance";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe-Admin-123456";
  const adminId = await seedAdminUser(db, {
    email,
    password,
    displayName: "Bootstrap Admin",
  });

  await seedM5TrainingDefinitions(db);

  console.log(`Seeded admin user: ${adminId}`);
  console.log(
    `Seeded reaction, Stroop, and digit-span training definitions for age bands 5-8, 9-12, 13-18`,
  );
  console.log(`Email: ${email}`);
  console.log("Password: [hidden — use SEED_ADMIN_PASSWORD or default from script source]");

  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
