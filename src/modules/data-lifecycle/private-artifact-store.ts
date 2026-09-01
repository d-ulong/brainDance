import { createReadStream, renameSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

import { DataLifecycleError } from "@/modules/data-lifecycle/errors";

export type PrivateArtifactStore = {
  put(key: string, content: Buffer): Promise<void>;
  /** Non-consuming read for authorized delivery envelopes. */
  read(key: string): Promise<Buffer | null>;
  openOnce(key: string): Promise<Buffer | null>;
  revoke(key: string): Promise<void>;
  purge(key: string): Promise<void>;
};

export function createMemoryArtifactStore(): PrivateArtifactStore & {
  has(key: string): boolean;
  isRevoked(key: string): boolean;
} {
  const stored = new Map<string, Buffer>();
  const revoked = new Set<string>();
  const consumed = new Set<string>();

  return {
    has(key) {
      return stored.has(key) && !revoked.has(key) && !consumed.has(key);
    },
    isRevoked(key) {
      return revoked.has(key);
    },
    async put(key, content) {
      if (revoked.has(key)) {
        throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Artifact has been revoked");
      }
      stored.set(key, Buffer.from(content));
      consumed.delete(key);
    },
    async read(key) {
      if (revoked.has(key) || consumed.has(key) || !stored.has(key)) {
        return null;
      }
      return Buffer.from(stored.get(key)!);
    },
    async openOnce(key) {
      if (revoked.has(key) || consumed.has(key) || !stored.has(key)) {
        return null;
      }
      const content = stored.get(key)!;
      consumed.add(key);
      stored.delete(key);
      return content;
    },
    async revoke(key) {
      revoked.add(key);
      stored.delete(key);
    },
    async purge(key) {
      revoked.add(key);
      stored.delete(key);
      consumed.add(key);
    },
  };
}

function assertSafeArtifactKey(key: string): string {
  if (!key || key.length > 240) {
    throw new DataLifecycleError("VALIDATION_ERROR", "Invalid artifact key");
  }
  if (key.includes("\0") || key.includes("\\")) {
    throw new DataLifecycleError("VALIDATION_ERROR", "Invalid artifact key");
  }
  const safeKey = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
  if (safeKey.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new DataLifecycleError("VALIDATION_ERROR", "Invalid artifact key");
  }
  return safeKey;
}

export function resolveConfiguredArtifactRoot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const configured = env.BRAIN_DANCE_ARTIFACT_ROOT?.trim();
  if (!configured) {
    throw new DataLifecycleError(
      "VALIDATION_ERROR",
      "BRAIN_DANCE_ARTIFACT_ROOT must be an absolute configured path",
    );
  }

  if (!path.isAbsolute(configured)) {
    throw new DataLifecycleError(
      "VALIDATION_ERROR",
      "BRAIN_DANCE_ARTIFACT_ROOT must be an absolute path",
    );
  }

  const normalized = path.normalize(configured);
  const forbiddenPrefixes = [path.normalize("/"), path.normalize("C:\\"), path.normalize("C:/")];
  if (
    normalized === path.parse(normalized).root ||
    forbiddenPrefixes.some((prefix) => normalized === prefix)
  ) {
    throw new DataLifecycleError(
      "VALIDATION_ERROR",
      "BRAIN_DANCE_ARTIFACT_ROOT must not be a filesystem root",
    );
  }

  const cwd = path.normalize(process.cwd());
  if (normalized === cwd || normalized.startsWith(`${cwd}${path.sep}`)) {
    // Allow only an explicit private subdirectory that is gitignored in local/dev.
    const allowedUnderRepo = path.normalize(path.join(cwd, ".braindance-artifacts"));
    if (
      normalized !== allowedUnderRepo &&
      !normalized.startsWith(`${allowedUnderRepo}${path.sep}`)
    ) {
      throw new DataLifecycleError(
        "VALIDATION_ERROR",
        "BRAIN_DANCE_ARTIFACT_ROOT under the repo must be .braindance-artifacts",
      );
    }
  }

  return normalized;
}

export function createFilesystemArtifactStore(rootDir: string): PrivateArtifactStore {
  const resolvedRoot = path.normalize(rootDir);
  if (!path.isAbsolute(resolvedRoot)) {
    throw new DataLifecycleError("VALIDATION_ERROR", "Artifact store root must be absolute");
  }

  async function resolvePath(key: string): Promise<string> {
    const safeKey = assertSafeArtifactKey(key);
    const fullPath = path.resolve(resolvedRoot, ...safeKey.split("/"));
    const relative = path.relative(resolvedRoot, fullPath);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative === "" ||
      relative.includes(`..${path.sep}`) ||
      relative === ".."
    ) {
      throw new DataLifecycleError("VALIDATION_ERROR", "Invalid artifact key");
    }
    await mkdir(path.dirname(fullPath), { recursive: true });
    return fullPath;
  }

  async function atomicWrite(filePath: string, content: Buffer): Promise<void> {
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, content);
      try {
        await rename(tempPath, filePath);
      } catch {
        // Windows may require replace via renameSync after unlink.
        try {
          await unlink(filePath);
        } catch {
          // target may not exist
        }
        renameSync(tempPath, filePath);
      }
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore cleanup failure
      }
      throw error;
    }
  }

  return {
    async put(key, content) {
      const filePath = await resolvePath(key);
      await atomicWrite(filePath, content);
    },
    async read(key) {
      const filePath = await resolvePath(key);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          return null;
        }
        return await readFile(filePath);
      } catch {
        return null;
      }
    },
    async openOnce(key) {
      const filePath = await resolvePath(key);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          return null;
        }
        const chunks: Buffer[] = [];
        await pipeline(createReadStream(filePath), async function* (source) {
          for await (const chunk of source) {
            chunks.push(Buffer.from(chunk));
          }
        });
        await unlink(filePath);
        return Buffer.concat(chunks);
      } catch {
        return null;
      }
    },
    async revoke(key) {
      const filePath = await resolvePath(key);
      try {
        await unlink(filePath);
      } catch {
        // already gone
      }
    },
    async purge(key) {
      await this.revoke(key);
    },
  };
}

export function createConfiguredFilesystemArtifactStore(
  env: NodeJS.ProcessEnv = process.env,
): PrivateArtifactStore {
  return createFilesystemArtifactStore(resolveConfiguredArtifactRoot(env));
}

/** Test-only absolute temp root helper. */
export function createTempFilesystemArtifactStore(): {
  store: PrivateArtifactStore;
  rootDir: string;
} {
  const rootDir = path.join(os.tmpdir(), `bd-artifacts-${randomUUID()}`);
  return { store: createFilesystemArtifactStore(rootDir), rootDir };
}
