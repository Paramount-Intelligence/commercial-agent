/**
 * Asset storage — production: Vercel Blob; local: .data/uploads (dev only).
 *
 * Files are never handed out by their storage URL: every download goes
 * through an app route that checks the session (lib/storage/serveFile.ts and
 * app/api/files/**, app/api/admin/files/**). Storage URLs stay server-side.
 *
 * Env:
 *   BLOB_READ_WRITE_TOKEN  the Vercel Blob store token. Unset → local fallback
 *                          under .data/uploads/ (gitignored, never served
 *                          statically).
 *   BLOB_PRIVATE_READ_WRITE_TOKEN  token of a private store connected with the
 *                          env prefix BLOB_PRIVATE; wins and is always private.
 *   BLOB_ACCESS            'private' for a private Blob store (recommended),
 *                          otherwise 'public'. A store's access mode is fixed
 *                          when it is created, so this must match the store.
 *
 * New files always get an unguessable name (random suffix). Reads accept both
 * the current store and legacy public URLs, so existing records keep working
 * while they are migrated (scripts/migrate-files-to-private.ts).
 */
import { put, del, get } from '@vercel/blob';
import { randomBytes } from 'crypto';
import { access, mkdir, readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';

export type UploadResult = { url: string };
export type StoredFile = { buffer: Buffer; contentType: string | null };

/** Folder prefixes; the -v2 ones mark files written by the current templates. */
export const GENERATED_ONEPAGER_PREFIX = 'generated/onepagers-v2/';
export const TRANSCRIPT_PREFIX = 'transcripts-v2/';
export const LEAD_PDF_PREFIX = 'leads/';

const LOCAL_URL_PREFIX = '/uploads/';
const LOCAL_DIR = path.join(process.cwd(), '.data', 'uploads');
/** Old local fallback (served statically before this change); read-only now. */
const LEGACY_LOCAL_DIR = path.join(process.cwd(), 'public', 'uploads');

/**
 * A private store connected with the env prefix BLOB_PRIVATE provides
 * BLOB_PRIVATE_READ_WRITE_TOKEN; it wins over BLOB_READ_WRITE_TOKEN and is
 * always private. This lets a project add a private store without editing an
 * existing (possibly locked) BLOB_READ_WRITE_TOKEN.
 */
function blobToken(): string | undefined {
  return (
    process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim() ||
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
    undefined
  );
}

function hasBlobToken(): boolean {
  return Boolean(blobToken());
}

export function blobAccess(): 'private' | 'public' {
  if (process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim()) return 'private';
  return process.env.BLOB_ACCESS?.trim().toLowerCase() === 'private' ? 'private' : 'public';
}

function safeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || 'asset';
}

function isBlobUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(url);
}

function localPathsFor(url: string): string[] {
  const rel = url.slice(LOCAL_URL_PREFIX.length).replace(/\.\.+/g, '');
  return [path.join(LOCAL_DIR, rel), path.join(LEGACY_LOCAL_DIR, rel)];
}

async function putBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<UploadResult> {
  if (hasBlobToken()) {
    const blob = await put(key, buffer, {
      access: blobAccess(),
      contentType,
      addRandomSuffix: true,
      token: blobToken(),
    });
    return { url: blob.url };
  }

  console.warn(
    '[storage/blob] BLOB_READ_WRITE_TOKEN unset — writing to .data/uploads (dev only).',
  );
  const ext = path.extname(key);
  const randomKey = `${key.slice(0, key.length - ext.length)}-${randomBytes(8).toString('hex')}${ext}`;
  const writePath = path.join(LOCAL_DIR, randomKey);
  await mkdir(path.dirname(writePath), { recursive: true });
  await writeFile(writePath, buffer);
  return { url: `${LOCAL_URL_PREFIX}${randomKey}` };
}

/** Upload an admin knowledge attachment (PDF/DOCX original). */
export async function uploadKnowledgeFile(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  return putBuffer(`admin-knowledge/${safeFilename(filename)}`, buffer, contentType);
}

/** Upload a buffer under a folder (case assets by default). */
export async function uploadAsset(
  buffer: Buffer,
  filename: string,
  contentType: string,
  folder = 'case-assets/',
): Promise<UploadResult> {
  return putBuffer(`${folder}${safeFilename(filename)}`, buffer, contentType);
}

/** Upload a generated one-pager (current template version). */
export async function uploadGeneratedOnepager(
  buffer: Buffer,
  caseId: string,
  format: 'pdf' | 'png',
): Promise<UploadResult> {
  const safeId = caseId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'case';
  const ext = format === 'png' ? 'png' : 'pdf';
  const contentType = format === 'png' ? 'image/png' : 'application/pdf';
  return putBuffer(`${GENERATED_ONEPAGER_PREFIX}${safeId}.${ext}`, buffer, contentType);
}

/** Read a stored file server-side (current store, legacy public URL or local). Null when missing. */
export async function readStoredFile(url: string): Promise<StoredFile | null> {
  if (!url) return null;
  if (url.startsWith(LOCAL_URL_PREFIX)) {
    for (const p of localPathsFor(url)) {
      try {
        return { buffer: await readFile(p), contentType: null };
      } catch {
        // try the next location
      }
    }
    return null;
  }
  if (!isBlobUrl(url)) return null; // external links (e.g. demo videos) are not served

  if (hasBlobToken() && blobAccess() === 'private') {
    try {
      const res = await get(url, { access: 'private', token: blobToken() });
      if (res && res.statusCode === 200) {
        const buffer = Buffer.from(await new Response(res.stream).arrayBuffer());
        return { buffer, contentType: res.blob.contentType ?? null };
      }
    } catch {
      // legacy public URL: fall through
    }
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
}

/** Verify a stored file is present before serving a cached URL. */
export async function assetExists(url: string): Promise<boolean> {
  if (!url.startsWith(LOCAL_URL_PREFIX)) return true;
  for (const p of localPathsFor(url)) {
    try {
      await access(p);
      return true;
    } catch {
      // try the next location
    }
  }
  return false;
}

/** Delete a previously uploaded asset by its URL. No-op if unknown/local-missing. */
export async function deleteAsset(url: string): Promise<void> {
  if (!url) return;

  if (url.startsWith(LOCAL_URL_PREFIX)) {
    for (const p of localPathsFor(url)) {
      try {
        await unlink(p);
      } catch {
        // already gone
      }
    }
    return;
  }

  if (hasBlobToken() && isBlobUrl(url)) {
    await del(url, { token: blobToken() }).catch(() => {}); // legacy files of another store: removed with that store
  }
  // External URL (e.g. DEMO_VIDEO YouTube link) — nothing to delete from storage
}
