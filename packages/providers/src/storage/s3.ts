import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSafeKey, type Storage } from "./storage";

export interface S3Config {
  bucket: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com for R2 */
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** S3-compatible storage (Cloudflare R2 in production). */
export class S3Storage implements Storage {
  private readonly client: S3Client;

  constructor(
    private readonly config: S3Config,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: config.region ?? "auto",
        endpoint: config.endpoint,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      });
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
      }),
    );
  }

  async getFile(key: string, destPath: string): Promise<void> {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    await mkdir(dirname(destPath), { recursive: true });
    await pipeline(res.Body as Readable, createWriteStream(destPath));
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
