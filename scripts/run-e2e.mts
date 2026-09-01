import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { config } from "dotenv";

import { assertPortFree, killProcessTree, logPortStatus } from "./e2e-port.mts";

config({ path: ".env.local" });
config({ path: ".env" });

const port = process.env.PLAYWRIGHT_PORT ?? "3003";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const sessionSecret =
  process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-characters-long";
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
const artifactRoot =
  process.env.BRAIN_DANCE_ARTIFACT_ROOT ?? path.join(process.cwd(), ".braindance-artifacts", "e2e");

const { NODE_ENV: _nodeEnv, ...processEnv } = process.env;
const sharedEnv = {
  ...processEnv,
  SESSION_SECRET: sessionSecret,
  SESSION_COOKIE_SECURE: "false",
  EXPOSE_DEV_OTP: "true",
  BRAIN_DANCE_ARTIFACT_ROOT: artifactRoot,
} satisfies Record<string, string | undefined>;

async function waitForServer(url: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) {
        return;
      }
    } catch {
      // Server still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`E2E server not ready at ${url} within ${timeoutMs}ms`);
}

function startServer(): ChildProcess {
  assertPortFree(port);

  const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
    stdio: "inherit",
    env: sharedEnv as NodeJS.ProcessEnv,
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("Failed to start E2E server process");
  }

  return child;
}

function startLifecycleWorker(): ChildProcess {
  const workerScript = path.join(process.cwd(), "scripts", "lifecycle-worker.mts");
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxCli, workerScript], {
    stdio: "inherit",
    env: {
      ...(sharedEnv as NodeJS.ProcessEnv),
      LIFECYCLE_WORKER_ID: "e2e-lifecycle-worker",
      LIFECYCLE_WORKER_IDLE_MS: "250",
    },
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("Failed to start lifecycle worker process");
  }

  return child;
}

function runPlaywright(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, "test"], {
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_SUPERVISED: "true",
        PLAYWRIGHT_PORT: port,
        PLAYWRIGHT_BASE_URL: baseURL,
        BRAIN_DANCE_ARTIFACT_ROOT: artifactRoot,
      },
    });

    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);

      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

async function main(): Promise<number> {
  let server: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  let exitCode = 1;

  try {
    execSync("pnpm build", {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", BRAIN_DANCE_ARTIFACT_ROOT: artifactRoot },
    });

    server = startServer();
    worker = startLifecycleWorker();
    await waitForServer(baseURL);
    void logPortStatus;
    exitCode = await runPlaywright();
  } finally {
    killProcessTree(worker?.pid);
    killProcessTree(server?.pid);

    if (server?.pid || worker?.pid) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    try {
      assertPortFree(port);
      console.log(`Port ${port}: no LISTENING process`);
    } catch (error) {
      console.error("[e2e-supervisor] cleanup failed:");
      console.error(error instanceof Error ? error.message : error);
      exitCode = 1;
    }
  }

  return exitCode;
}

const exitCode = await main();
process.exit(exitCode);
