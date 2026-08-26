import { execSync } from "node:child_process";

const port = process.env.PLAYWRIGHT_PORT ?? "3002";

function assertPortFree(): void {
  if (process.platform === "win32") {
    try {
      const output = execSync(`netstat -ano | findstr ":${port}.*LISTENING"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (output) {
        console.error(`Port ${port} still LISTENING after Playwright exit:\n${output}`);
        process.exit(1);
      }

      return;
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error ? error.status : null;
      if (status === 1) {
        console.log(`Port ${port}: no LISTENING process`);
        return;
      }

      throw error;
    }
  }

  try {
    execSync(`bash -lc "ss -ltn '( sport = :${port} )' | tail -n +2 | grep -q ."`, {
      stdio: "ignore",
    });
    console.error(`Port ${port} still LISTENING after Playwright exit`);
    process.exit(1);
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error ? error.status : null;
    if (status === 1) {
      console.log(`Port ${port}: no LISTENING process`);
      return;
    }

    throw error;
  }
}

assertPortFree();
