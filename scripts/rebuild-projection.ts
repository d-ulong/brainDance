import { config } from "dotenv";

import { getDb } from "@/db";
import { rebuildProjection } from "@/modules/projection/rebuild-projection.service";

config({ path: ".env.local" });
config({ path: ".env" });

function printUsage(): void {
  console.error("Usage: pnpm rebuild-projection [--student-id <uuid>]");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    const db = getDb();
    const result = await rebuildProjection(db);
    console.log(
      JSON.stringify({
        studentsScanned: result.studentsScanned,
        studentsRebuilt: result.studentsRebuilt,
        ledgerEntriesScanned: result.ledgerEntriesScanned,
      }),
    );
    return;
  }

  if (args.length === 2 && args[0] === "--student-id") {
    const studentId = args[1];
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(studentId)) {
      console.error("Invalid student-id: must be a UUID");
      process.exit(1);
    }

    const db = getDb();
    const result = await rebuildProjection(db, { studentId });
    console.log(
      JSON.stringify({
        studentsScanned: result.studentsScanned,
        studentsRebuilt: result.studentsRebuilt,
        ledgerEntriesScanned: result.ledgerEntriesScanned,
      }),
    );
    return;
  }

  printUsage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Rebuild failed");
  process.exit(1);
});
