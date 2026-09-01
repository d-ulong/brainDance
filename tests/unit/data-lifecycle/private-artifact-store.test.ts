import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFilesystemArtifactStore,
  createMemoryArtifactStore,
  resolveConfiguredArtifactRoot,
} from "@/modules/data-lifecycle/private-artifact-store";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";

describe("private artifact store persistence", () => {
  it("C02: filesystem adapter survives across store instances (restart-equivalent)", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "bd-artifact-"));
    try {
      const first = createFilesystemArtifactStore(rootDir);
      await first.put("export/job-1", Buffer.from('{"ok":true}', "utf8"));

      const second = createFilesystemArtifactStore(rootDir);
      const readBack = await second.read("export/job-1");
      expect(readBack?.toString("utf8")).toBe('{"ok":true}');

      const once = await second.openOnce("export/job-1");
      expect(once?.toString("utf8")).toBe('{"ok":true}');
      expect(await second.read("export/job-1")).toBeNull();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("C02: filesystem delete/purge and path traversal rejection", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "bd-artifact-"));
    try {
      const store = createFilesystemArtifactStore(rootDir);
      await store.put("export/safe", Buffer.from("x"));
      await store.purge("export/safe");
      expect(await store.read("export/safe")).toBeNull();

      await expect(store.put("../escape", Buffer.from("nope"))).rejects.toBeInstanceOf(
        DataLifecycleError,
      );
      await expect(store.put("a/../../escape", Buffer.from("nope"))).rejects.toBeInstanceOf(
        DataLifecycleError,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("C02: configured root rejects missing/relative/unsafe paths", () => {
    expect(() => resolveConfiguredArtifactRoot({})).toThrow(/BRAIN_DANCE_ARTIFACT_ROOT/);
    expect(() =>
      resolveConfiguredArtifactRoot({ BRAIN_DANCE_ARTIFACT_ROOT: "relative/path" }),
    ).toThrow(/absolute/);
    expect(() =>
      resolveConfiguredArtifactRoot({
        BRAIN_DANCE_ARTIFACT_ROOT: path.join(process.cwd(), "src"),
      }),
    ).toThrow(/\.braindance-artifacts/);
  });

  it("C02: memory adapter remains available for tests only", async () => {
    const store = createMemoryArtifactStore();
    await store.put("k", Buffer.from("v"));
    expect((await store.read("k"))?.toString("utf8")).toBe("v");
    expect(store.has("k")).toBe(true);
  });
});
