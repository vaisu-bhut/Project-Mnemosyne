import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
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

// Convert stream to Buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk: any) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export function createArtifactStore(config: Partial<Pick<AppConfig, "S3_BUCKET_NAME" | "AWS_REGION">> & { LOCAL_STORAGE_DIR: string }): ArtifactStore {
  // If S3_BUCKET_NAME is provided, use AWS S3
  if (config.S3_BUCKET_NAME) {
    const s3 = new S3Client({ region: config.AWS_REGION });
    const bucket = config.S3_BUCKET_NAME;

    return {
      async init() {
        // S3 bucket is managed by Terraform, but we can verify access
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      },
      async putArtifact(key, body, contentType) {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
          })
        );
      },
      async getArtifact(key) {
        const res = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        return streamToBuffer(res.Body);
      },
      async deleteArtifact(key) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: key,
            })
          );
        } catch (err: any) {
          if (err.name !== "NoSuchKey") throw err;
        }
      },
      async reachable() {
        try {
          await s3.send(new HeadBucketCommand({ Bucket: bucket }));
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  // Fallback to local filesystem
  const baseDir = path.resolve(config.LOCAL_STORAGE_DIR);

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
