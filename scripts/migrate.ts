import { config } from "dotenv";

import { runMigrationsWithMediaCompatibilityGate } from "../src/db/run-migrations-with-media-gate";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  console.log("Running migrations...");
  await runMigrationsWithMediaCompatibilityGate();
  console.log("Migrations complete.");
  console.log("Media migration compatibility check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
