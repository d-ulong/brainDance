import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const launcher = path.join(process.cwd(), "scripts", "start-web-and-worker.ps1");
describe("Windows update and restart launcher", () => {
  it("pulls only by fast-forward before stopping, installing, migrating and building", () => {
    const script = readFileSync(launcher, "utf8");
    const pull = script.indexOf('Invoke-Checked "git" @("pull", "--ff-only")');
    const stop = script.indexOf("foreach ($service in $state.services)");
    const install = script.indexOf('Invoke-Checked "pnpm" @("install", "--frozen-lockfile")');
    const migrate = script.indexOf('Invoke-Checked "pnpm" @("db:migrate")');
    const build = script.indexOf('Invoke-Checked "pnpm" @("build")');
    const start = script.indexOf("$process = Start-Process");
    expect(pull).toBeGreaterThan(script.indexOf("if ($dirty)"));
    expect(stop).toBeGreaterThan(pull);
    expect(install).toBeGreaterThan(stop);
    expect(migrate).toBeGreaterThan(install);
    expect(build).toBeGreaterThan(migrate);
    expect(start).toBeGreaterThan(build);
    expect(script).toContain(
      '$running.StartTime.ToUniversalTime().ToString("o") -ne $Service.startedAt',
    );
    expect(script).toContain("CommandLine.IndexOf($launcherPath");
    expect(script).not.toMatch(/taskkill.*\/IM|git.*(?:reset|rebase|stash)/i);
  });

  it.skipIf(process.platform !== "win32").each(["dirty", "pull-fails", "no-upstream"])(
    "%s leaves service state unchanged and does not run dependencies or migrations",
    (scenario) => {
      const temp = mkdtempSync(path.join(os.tmpdir(), "braindance-launcher-"));
      try {
        const scripts = path.join(temp, "scripts");
        const bin = path.join(temp, "bin");
        const state = path.join(temp, ".review-runtime", "windows-launcher");
        mkdirSync(scripts);
        mkdirSync(bin);
        mkdirSync(state, { recursive: true });
        copyFileSync(launcher, path.join(scripts, "start-web-and-worker.ps1"));
        const sentinel = '{"repoRoot":"must-not-be-read-before-pull","services":[]}';
        writeFileSync(path.join(state, "services.json"), sentinel);
        writeFileSync(
          path.join(bin, "git.cmd"),
          [
            "@echo off",
            'echo git %*>>"%BD_TEST_LOG%"',
            'if "%1"=="rev-parse" if "%BD_TEST_SCENARIO%"=="no-upstream" exit /b 1',
            'if "%1"=="status" if "%BD_TEST_SCENARIO%"=="dirty" echo M tracked.ts',
            'if "%1"=="pull" exit /b 1',
            "exit /b 0",
            "",
          ].join("\r\n"),
        );
        writeFileSync(
          path.join(bin, "pnpm.cmd"),
          '@echo pnpm-called>>"%BD_TEST_LOG%"\r\n@exit /b 97\r\n',
        );
        const log = path.join(temp, "calls.log");
        const result = spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.join(scripts, "start-web-and-worker.ps1"),
            "-Mode",
            "start",
          ],
          {
            env: {
              ...process.env,
              PATH: `${bin};${process.env.PATH}`,
              BD_TEST_LOG: log,
              BD_TEST_SCENARIO: scenario,
            },
            encoding: "utf8",
            timeout: 20_000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stdout + result.stderr).toBe(1);
        expect(readFileSync(path.join(state, "services.json"), "utf8")).toBe(sentinel);
        expect(existsSync(log)).toBe(true);
        const calls = readFileSync(log, "utf8");
        expect(calls).not.toContain("pnpm-called");
        expect(calls.includes("git pull --ff-only")).toBe(scenario === "pull-fails");
        expect(result.stdout).not.toContain("Cannot verify ownership");
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    },
    25_000,
  );
});
