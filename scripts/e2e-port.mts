import { execSync } from "node:child_process";

export function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) {
    return;
  }

  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      return;
    }

    process.kill(-pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

export function assertPortFree(port: string): void {
  if (process.platform === "win32") {
    try {
      const output = execSync(`netstat -ano | findstr ":${port}.*LISTENING"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (output) {
        throw new Error(`Port ${port} still LISTENING:\n${output}`);
      }

      return;
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error ? error.status : null;
      if (status === 1) {
        return;
      }

      throw error;
    }
  }

  try {
    execSync(`bash -lc "ss -ltn '( sport = :${port} )' | tail -n +2 | grep -q ."`, {
      stdio: "ignore",
    });
    throw new Error(`Port ${port} still LISTENING`);
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error ? error.status : null;
    if (status === 1) {
      return;
    }

    throw error;
  }
}

export function logPortStatus(port: string): void {
  try {
    assertPortFree(port);
    console.log(`Port ${port}: no LISTENING process`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
