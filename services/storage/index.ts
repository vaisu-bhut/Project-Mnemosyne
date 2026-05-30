import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/index.js";

export interface ArtifactStore {
  /** Ensure the storage directory exists. Call once on startup. */
  init(): Promise<void>;
  putArtifact(key: string, body: Buffer, contentType: string): Promise<void>;
  getArtifact(key: string): Promise<Buffer>;
  deleteArtifact(key: string): Promise<void>;
  /** Liveness probe for the health endpoint. */
  reachable(): Promise<boolean>;
}

type StorageConfig = Pick<AppConfig, "LOCAL_STORAGE_DIR">;

/**
 * Local-filesystem artifact store. Keys behave like S3 keys (slashes allowed,
 * creating subdirectories). The public interface matches what an S3-backed
 * store would expose, so swapping in real object storage later only changes
 * this file — callers are unaffected.
 *
 * NOTE: contentType is accepted to keep the interface stable but is not
 * persisted locally (the filesystem has no per-object metadata slot we need
 * yet). Re-introduce a sidecar or switch to S3 when that matters.
 */
export function createArtifactStore(config: StorageConfig): ArtifactStore {
  const baseDir = path.resolve(config.LOCAL_STORAGE_DIR);

  /** Resolve a key to an absolute path, refusing traversal outside baseDir. */
  function resolveKey(key: string): string {
    const full = path.resolve(baseDir, key);
    const rel = path.relative(baseDir, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Invalid artifact key (path traversal): ${key}`);
    }
    return full;
  }

  return {
    async init() {
      await fs.mkdir(baseDir, { recursive: true });
    },

    async putArtifact(key, body, _contentType) {
      const full = resolveKey(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
    },

    async getArtifact(key) {
      return fs.readFile(resolveKey(key));
    },

    async deleteArtifact(key) {
      try {
        await fs.unlink(resolveKey(key));
      } catch (err) {
        // Idempotent delete, like S3: a missing object is not an error.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },

    async reachable() {
      try {
        await fs.mkdir(baseDir, { recursive: true });
        await fs.access(baseDir);
        return true;
      } catch {
        return false;
      }
    },
  };
}
