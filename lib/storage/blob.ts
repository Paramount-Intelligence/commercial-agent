/**
 * Asset storage — production: Vercel Blob; local: public/uploads (dev only).
 *
 * Env: BLOB_READ_WRITE_TOKEN from the Vercel project's Blob store.
 *   - Set in .env.local for local Blob testing, or leave unset to use the
 *     local filesystem fallback under public/uploads/.
 *   - Production (Vercel) must have BLOB_READ_WRITE_TOKEN configured —
 *     local uploads are not durable across deploys.
 */
import { put, del } from '@vercel/blob';
import { randomBytes } from 'crypto';
import { access, mkdir, writeFile, unlink } from 'fs/promises';
import path from 'path';

export type UploadResult = { url: string };

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function safeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || 'asset';
}

async function putBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<UploadResult> {
  if (hasBlobToken()) {
    const blob = await put(key, buffer, {
      access: 'public',
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: blob.url };
  }

  console.warn(
    '[storage/blob] BLOB_READ_WRITE_TOKEN unset — writing to public/uploads (dev only). ' +
      'Set the token from your Vercel Blob store for production.',
  );
  const uploadsDir = path.join(
    process.cwd(),
    'public',
    'uploads',
    path.dirname(key),
  );
  await mkdir(uploadsDir, { recursive: true });
  const localName = path.basename(key);
  const writePath = path.join(uploadsDir, localName);
  const url = `/uploads/${key}`;
  await writeFile(writePath, buffer);
  console.info('[storage/blob] local asset written', { writePath, url });
  return { url };
}

/**
 * Upload a buffer. Returns a public URL.
 * Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set; otherwise writes under
 * public/uploads/ and returns a /uploads/... path (dev only).
 */
export async function uploadAsset(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  const safe = safeFilename(filename);
  const key = `case-assets/${Date.now()}-${randomBytes(4).toString('hex')}-${safe}`;
  return putBuffer(key, buffer, contentType);
}

/**
 * Upload a generated one-pager to generated/onepagers/<caseId>-<ts>.<ext>.
 */
export async function uploadGeneratedOnepager(
  buffer: Buffer,
  caseId: string,
  format: 'pdf' | 'png',
): Promise<UploadResult> {
  const safeId = caseId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'case';
  const ext = format === 'png' ? 'png' : 'pdf';
  const contentType = format === 'png' ? 'image/png' : 'application/pdf';
  // Local URLs are persisted in Messages, so they must remain stable across
  // concurrent/regenerated documents. Blob objects remain versioned.
  const version = hasBlobToken() ? `-${Date.now()}` : '';
  const key = `generated/onepagers/${safeId}${version}.${ext}`;
  return putBuffer(key, buffer, contentType);
}

/** Verify local fallback files before serving a cached URL. */
export async function assetExists(url: string): Promise<boolean> {
  if (!url.startsWith('/uploads/')) return true;
  const filePath = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Delete a previously uploaded asset by its URL. No-op if unknown/local-missing. */
export async function deleteAsset(url: string): Promise<void> {
  if (!url) return;

  // Local fallback URLs
  if (url.startsWith('/uploads/')) {
    const filePath = path.join(process.cwd(), 'public', url.replace(/^\//, ''));
    try {
      await unlink(filePath);
    } catch {
      // already gone
    }
    return;
  }

  // Vercel Blob public URLs
  if (hasBlobToken() && /vercel-storage\.com|blob\.vercel-storage\.com/i.test(url)) {
    await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return;
  }

  // External URL (e.g. DEMO_VIDEO YouTube link) — nothing to delete from storage
}
