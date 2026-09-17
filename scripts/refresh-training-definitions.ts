import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import { seedM5TrainingDefinitions } from "../src/modules/training/definition.service";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  await seedM5TrainingDefinitions(db as never);
  console.log(
    "Ensured active training definitions (reaction/stroop/digit-span); schema changes insert a new version.",
  );
  await client.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
