import { execSync, spawn, type ChildProcess } from "node:child_process";

const port = process.env.PLAYWRIGHT_PORT ?? "3002";

execSync("pnpm build", {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

const serverEnv = { ...process.env, SESSION_SECRET: process.env.SESSION_SECRET };
delete serverEnv.NODE_ENV;

const child: ChildProcess = spawn("pnpm", ["exec", "next", "start", "-p", port], {
  stdio: "inherit",
  env: serverEnv,
  shell: true,
});

function shutdown(signal: NodeJS.Signals) {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
