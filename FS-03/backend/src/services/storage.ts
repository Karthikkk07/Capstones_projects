import fs from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
};

export interface S3Like {
  send(command: PutObjectCommand): Promise<unknown>;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Uploads every file under localDir to s3://bucket/<keyPrefix>/<relative path>. Returns the keys uploaded. */
export async function uploadDirectoryToS3(
  localDir: string,
  keyPrefix: string,
  opts: { bucket: string; region?: string; client?: S3Like },
): Promise<string[]> {
  const client = opts.client ?? new S3Client({ region: opts.region });
  const keys: string[] = [];
  for await (const file of walk(localDir)) {
    const rel = path.relative(localDir, file).split(path.sep).join('/');
    const key = `${keyPrefix}/${rel}`;
    await client.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: key,
        Body: await fs.readFile(file),
        ContentType: CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        CacheControl: file.endsWith('.m3u8') ? 'public, max-age=60' : 'public, max-age=31536000, immutable',
      }),
    );
    keys.push(key);
  }
  return keys;
}
