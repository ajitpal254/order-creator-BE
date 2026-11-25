import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { logger } from '../utils/logger.js';

/**
 * Storage service (SEC-09, v0.3)
 *
 * One small interface over object storage so product images are not
 * hard-wired to the local disk:
 *
 *   put(key, buffer, contentType) -> { key, url, path }
 *   get(key)                      -> Buffer
 *   getStream(key)                -> Readable
 *   delete(key)                   -> boolean (true when something was removed)
 *
 * Drivers:
 *  - local (default): files under the uploads dir (UPLOADS_DIR env or
 *    <cwd>/uploads — the same directory server.js serves at /uploads and
 *    multer used before this abstraction, so previously uploaded files
 *    keep working unchanged). `url` is the public path /uploads/<key>.
 *  - s3: active ONLY when STORAGE_DRIVER=s3 AND both S3_BUCKET and
 *    S3_REGION are set. Uses the official @aws-sdk/client-s3 (SigV4
 *    signing is impractical to hand-roll correctly). Optional:
 *    S3_ENDPOINT (S3-compatible stores), S3_ACCESS_KEY_ID /
 *    S3_SECRET_ACCESS_KEY (when unset, the SDK's default credential
 *    chain applies). `url` is the object's public URL.
 *
 * If STORAGE_DRIVER=s3 but the config is incomplete, the service falls
 * back to local and logs a warning — a misconfigured deploy must not
 * take image uploads down.
 */

const DEFAULT_UPLOADS_DIR = () => process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');

// Keys are generated server-side (prod_<ts>_<hex>.<ext>); still, refuse
// anything that could escape the local uploads dir.
const assertSafeKey = (key) => {
  if (!key || typeof key !== 'string' || key.includes('..') || path.isAbsolute(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
};

export const createLocalDriver = ({ baseDir = DEFAULT_UPLOADS_DIR() } = {}) => {
  const resolve = (key) => {
    assertSafeKey(key);
    return path.join(baseDir, key);
  };

  return {
    name: 'local',
    baseDir,
    async put(key, buffer) {
      const filePath = resolve(key);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, buffer);
      return { key, url: `/uploads/${key}`, path: filePath };
    },
    async get(key) {
      return fsp.readFile(resolve(key));
    },
    async getStream(key) {
      return fs.createReadStream(resolve(key));
    },
    async delete(key) {
      try {
        await fsp.unlink(resolve(key));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },
  };
};

export const createS3Driver = async ({ bucket, region, endpoint, accessKeyId, secretAccessKey } = {}) => {
  // Lazy import: the SDK is only loaded when the s3 driver is selected.
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import(
    '@aws-sdk/client-s3'
  );

  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });

  const publicUrl = (key) =>
    endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  return {
    name: 's3',
    bucket,
    async put(key, buffer, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
      );
      return { key, url: publicUrl(key), path: publicUrl(key) };
    },
    async get(key) {
      assertSafeKey(key);
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await out.Body.transformToByteArray());
    },
    async getStream(key) {
      assertSafeKey(key);
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return out.Body instanceof Readable ? out.Body : Readable.from(out.Body);
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    },
  };
};

/**
 * Decide which driver the environment selects. Pure (no I/O) apart from
 * the fallback warning, so driver selection is unit-testable.
 *
 * @param {object} [env]
 * @param {(msg: string) => void} [warn]
 * @returns {'local'|'s3'}
 */
export const resolveStorageDriverName = (env = process.env, warn = (msg) => logger.warn(msg)) => {
  if ((env.STORAGE_DRIVER || 'local').toLowerCase() !== 's3') return 'local';
  if (env.S3_BUCKET && env.S3_REGION) return 's3';
  warn(
    'STORAGE_DRIVER=s3 but S3_BUCKET/S3_REGION are not both set — falling back to local storage.'
  );
  return 'local';
};

/**
 * Build a storage service for an explicit config (used by tests and by
 * the default singleton below).
 */
export const createStorage = async ({ env = process.env, baseDir, warn } = {}) => {
  const driverName = resolveStorageDriverName(env, warn);
  if (driverName === 's3') {
    return createS3Driver({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
    });
  }
  return createLocalDriver({ baseDir: baseDir || DEFAULT_UPLOADS_DIR() });
};

// Default singleton for the app. Local unless the env fully configures
// s3 — resolved once at module load, like the other boot-time config.
export const storage = await createStorage();
