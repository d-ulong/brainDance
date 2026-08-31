import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { DataLifecycleError } from "@/modules/data-lifecycle/errors";

export type PrivateArtifactStore = {
  put(key: string, content: Buffer): Promise<void>;
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
    has(key: string) {
      return stored.has(key) && !revoked.has(key) && !consumed.has(key);
    },
    isRevoked(key: string) {
      return revoked.has(key);
    },
    async put(key, content) {
      if (revoked.has(key)) {
        throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Artifact has been revoked");
      }
      stored.set(key, Buffer.from(content));
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

export function createFilesystemArtifactStore(rootDir: string): PrivateArtifactStore {
  async function resolvePath(key: string): Promise<string> {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fullPath = path.join(rootDir, safeKey);
    const relative = path.relative(rootDir, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new DataLifecycleError("VALIDATION_ERROR", "Invalid artifact key");
    }
    await mkdir(rootDir, { recursive: true });
    return fullPath;
  }

  return {
    async put(key, content) {
      const filePath = await resolvePath(key);
      await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(filePath);
        stream.on("error", reject);
        stream.on("finish", resolve);
        stream.end(content);
      });
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
