import { execSync } from "node:child_process";

export default async function globalSetup() {
  execSync("tsx scripts/e2e-bootstrap.ts", {
    stdio: "inherit",
    env: process.env,
  });
}
