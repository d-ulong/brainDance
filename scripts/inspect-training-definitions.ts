import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const sql = postgres(url, { max: 1 });
  const rows = await sql`
    select training_key, age_band, version, active, metric_schema
    from training_definitions
    where active = 1
    order by training_key, age_band
  `;
  for (const row of rows) {
    console.log(
      `${row.training_key}/${row.age_band} v${row.version}: ${JSON.stringify(row.metric_schema)}`,
    );
  }
  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
