import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("production Windows launcher", () => {
  it("migrates and rebuilds the current checkout before starting web and worker", () => {
    const script = readFileSync(
      path.join(process.cwd(), "scripts", "start-web-and-worker.bat"),
      "utf8",
    );
    const migrate = script.indexOf("call pnpm db:migrate");
    const build = script.indexOf("call pnpm build");
    const webStart = script.indexOf('start "BrainDance Web"');
    const workerStart = script.indexOf('start "BrainDance Worker"');

    expect(migrate).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(migrate);
    expect(webStart).toBeGreaterThan(build);
    expect(workerStart).toBeGreaterThan(webStart);
    expect(script).not.toContain("Found existing production build");
    expect(script).not.toContain("No production build found");
  });
});
