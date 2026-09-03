import { renameSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { FamilyContentError } from "@/modules/family-content/errors";

export type PrivateMediaStore = {
  putStaging(key: string, content: Buffer): Promise<void>;
  readStaging(key: string): Promise<Buffer | null>;
  deleteStaging(key: string): Promise<void>;
  promoteSafe(stagingKey: string, safeKey: string, content: Buffer): Promise<void>;
  readSafe(key: string): Promise<Buffer | null>;
  revokeSafe(key: string): Promise<void>;
  purgeSafe(key: string): Promise<void>;
  purgeStaging(key: string): Promise<void>;
};

export function assertSafeMediaKey(key: string): string {
  if (!key || key.length > 240) {
    throw new FamilyContentError("VALIDATION_ERROR", "Invalid media key");
  }
  if (key.includes("\0") || key.includes("\\")) {
    throw new FamilyContentError("VALIDATION_ERROR", "Invalid media key");
  }
  const safeKey = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
  if (safeKey.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new FamilyContentError("VALIDATION_ERROR", "Invalid media key");
  }
  return safeKey;
}

export function resolveConfiguredMediaRoot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const configured = env.BRAIN_DANCE_MEDIA_ROOT?.trim();
  if (!configured) {
    throw new FamilyContentError(
      "VALIDATION_ERROR",
      "BRAIN_DANCE_MEDIA_ROOT must be an absolute configured path",
    );
  }

  if (!path.isAbsolute(configured)) {
    throw new FamilyContentError(
      "VALIDATION_ERROR",
      "BRAIN_DANCE_MEDIA_ROOT must be an absolute path",
    );
  }

  const normalized = path.normalize(configured);
  const forbiddenPrefixes = [path.normalize("/"), path.normalize("C:\\"), path.normalize("C:/")];
  if (
    normalized === path.parse(normalized).root ||
    forbiddenPrefixes.some((prefix) => normalized === prefix)
  ) {
    throw new FamilyContentError(
      "VALIDATION_ERROR",
      "BRAIN_DANCE_MEDIA_ROOT must not be a filesystem root",
    );
  }

  const cwd = path.normalize(process.cwd());
  if (normalized === cwd || normalized.startsWith(`${cwd}${path.sep}`)) {
    const allowedUnderRepo = path.normalize(path.join(cwd, ".braindance-media"));
    if (
      normalized !== allowedUnderRepo &&
      !normalized.startsWith(`${allowedUnderRepo}${path.sep}`)
    ) {
      throw new FamilyContentError(
        "VALIDATION_ERROR",
        "BRAIN_DANCE_MEDIA_ROOT under the repo must be .braindance-media",
      );
    }
  }

  return normalized;
}

export function createMemoryMediaStore(): PrivateMediaStore & {
  hasStaging(key: string): boolean;
  hasSafe(key: string): boolean;
} {
  const staging = new Map<string, Buffer>();
  const safe = new Map<string, Buffer>();

  return {
    hasStaging(key) {
      return staging.has(key);
    },
    hasSafe(key) {
      return safe.has(key);
    },
    async putStaging(key, content) {
      assertSafeMediaKey(key);
      staging.set(key, Buffer.from(content));
    },
    async readStaging(key) {
      assertSafeMediaKey(key);
      const content = staging.get(key);
      return content ? Buffer.from(content) : null;
    },
    async deleteStaging(key) {
      assertSafeMediaKey(key);
      staging.delete(key);
    },
    async promoteSafe(stagingKey, safeKey, content) {
      assertSafeMediaKey(stagingKey);
      assertSafeMediaKey(safeKey);
      safe.set(safeKey, Buffer.from(content));
      staging.delete(stagingKey);
    },
    async readSafe(key) {
      assertSafeMediaKey(key);
      const content = safe.get(key);
      return content ? Buffer.from(content) : null;
    },
    async revokeSafe(_key) {
      // Ordinary revoke is DB-side (refs/capabilities/status). Physical objects
      // remain until the +90 day purge lifecycle; never treat revoke as delete.
      assertSafeMediaKey(_key);
    },
    async purgeSafe(key) {
      assertSafeMediaKey(key);
      safe.delete(key);
    },
    async purgeStaging(key) {
      assertSafeMediaKey(key);
      staging.delete(key);
    },
  };
}

export function createFilesystemMediaStore(rootDir: string): PrivateMediaStore {
  const resolvedRoot = path.normalize(rootDir);
  if (!path.isAbsolute(resolvedRoot)) {
    throw new FamilyContentError("VALIDATION_ERROR", "Media store root must be absolute");
  }

  async function resolvePath(key: string): Promise<string> {
    const safeKey = assertSafeMediaKey(key);
    const fullPath = path.resolve(resolvedRoot, ...safeKey.split("/"));
    const relative = path.relative(resolvedRoot, fullPath);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative === "" ||
      relative.includes(`..${path.sep}`) ||
      relative === ".."
    ) {
      throw new FamilyContentError("VALIDATION_ERROR", "Invalid media key");
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

  async function readIfFile(filePath: string): Promise<Buffer | null> {
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        return null;
      }
      return await readFile(filePath);
    } catch {
      return null;
    }
  }

  async function deleteIfPresent(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // already gone
    }
  }

  return {
    async putStaging(key, content) {
      const filePath = await resolvePath(key);
      await atomicWrite(filePath, content);
    },
    async readStaging(key) {
      const filePath = await resolvePath(key);
      return readIfFile(filePath);
    },
    async deleteStaging(key) {
      const filePath = await resolvePath(key);
      await deleteIfPresent(filePath);
    },
    async promoteSafe(stagingKey, safeKey, content) {
      const safePath = await resolvePath(safeKey);
      await atomicWrite(safePath, content);
      const stagingPath = await resolvePath(stagingKey);
      await deleteIfPresent(stagingPath);
    },
    async readSafe(key) {
      const filePath = await resolvePath(key);
      return readIfFile(filePath);
    },
    async revokeSafe(key) {
      // Ordinary revoke must not physically delete; lifecycle purge owns deletion.
      assertSafeMediaKey(key);
    },
    async purgeSafe(key) {
      const filePath = await resolvePath(key);
      await deleteIfPresent(filePath);
    },
    async purgeStaging(key) {
      const filePath = await resolvePath(key);
      await deleteIfPresent(filePath);
    },
  };
}

export function createConfiguredFilesystemMediaStore(
  env: NodeJS.ProcessEnv = process.env,
): PrivateMediaStore {
  return createFilesystemMediaStore(resolveConfiguredMediaRoot(env));
}

/** Test-only absolute temp root helper. */
export function createTempFilesystemMediaStore(): {
  store: PrivateMediaStore;
  rootDir: string;
} {
  const rootDir = path.join(os.tmpdir(), `bd-media-${randomUUID()}`);
  return { store: createFilesystemMediaStore(rootDir), rootDir };
}
