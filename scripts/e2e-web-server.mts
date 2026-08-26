import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const port = process.env.PLAYWRIGHT_PORT ?? "3002";
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

execSync("pnpm build", {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

const serverEnv = { ...process.env, PLAYWRIGHT_PORT: port };
delete serverEnv.NODE_ENV;

const child: ChildProcess = spawn(process.execPath, [nextBin, "start", "-p", port], {
  stdio: "inherit",
  env: serverEnv,
  detached: process.platform !== "win32",
  windowsHide: true,
});

function killProcessTree(pid: number | undefined): void {
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

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  killProcessTree(child.pid);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);

child.on("exit", (code, signal) => {
  if (signal && !shuttingDown) {
    shutdown();
  }

  process.exit(code ?? (signal ? 1 : 0));
});
