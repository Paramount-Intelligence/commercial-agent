/**
 * Asset storage — Vercel Blob on Vercel; local disk (.data/uploads) otherwise.
 *
 * Files are never handed out by their storage URL: every download goes
 * through an app route that checks the session (lib/storage/serveFile.ts and
 * app/api/files/**, app/api/admin/files/**). Storage URLs stay server-side.
 *
 * Storage mode (storageMode()), first match wins:
 *   1. private-oidc   On Vercel (VERCEL=1) with BLOB_PRIVATE_STORE_ID: the
 *                     private store connected with the env prefix
 *                     BLOB_PRIVATE. Private stores have no read-write token;
 *                     the SDK authenticates with the project's short-lived
 *                     OIDC token, so we pass only the store id.
 *   2. private-token  BLOB_PRIVATE_READ_WRITE_TOKEN (only if a private store
 *                     ever issues one; lets a laptop script reach it).
 *   3. token          BLOB_READ_WRITE_TOKEN; access from BLOB_ACCESS
 *                     ('private' or 'public', must match that store).
 *   4. local          No credentials: files under .data/uploads/ (gitignored,
 *                     never served statically). This is local development;
 *                     BLOB_PRIVATE_STORE_ID alone (no Vercel) never selects
 *                     a store, so nothing breaks when it is absent or pulled.
 *
 * New files always get an unguessable name (random suffix). Reads accept the
 * current store, legacy public URLs and local paths, so existing records keep
 * working while they are moved (lib/storage/migrateFiles.ts).
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

export type StorageMode =
  | { kind: 'private-oidc'; access: 'private'; storeId: string }
  | { kind: 'private-token'; access: 'private'; token: string }
  | { kind: 'token'; access: 'private' | 'public'; token: string }
  | { kind: 'local'; access: 'public' };

type Env = Record<string, string | undefined>;

export function storageMode(env: Env = process.env): StorageMode {
  const storeId = env.BLOB_PRIVATE_STORE_ID?.trim();
  if (storeId && env.VERCEL?.trim() === '1') return { kind: 'private-oidc', access: 'private', storeId };
  const privateToken = env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim();
  if (privateToken) return { kind: 'private-token', access: 'private', token: privateToken };
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const access = env.BLOB_ACCESS?.trim().toLowerCase() === 'private' ? 'private' : 'public';
    return { kind: 'token', access, token };
  }
  return { kind: 'local', access: 'public' };
}

/** SDK credentials for the current mode: a token, or a store id (OIDC). */
function sdkAuth(mode: StorageMode): { token?: string; storeId?: string } {
  if (mode.kind === 'private-oidc') return { storeId: mode.storeId };
  if (mode.kind === 'local') return {};
  return { token: mode.token };
}

export function blobAccess(): 'private' | 'public' {
  return storageMode().access;
}

function safeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || 'asset';
}

function isBlobUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(url);
}

function isPublicBlobUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url);
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
  const mode = storageMode();
  if (mode.kind !== 'local') {
    const blob = await put(key, buffer, {
      access: mode.access,
      contentType,
      addRandomSuffix: true,
      ...sdkAuth(mode),
    });
    return { url: blob.url };
  }

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

  // Legacy public files are readable without credentials.
  if (isPublicBlobUrl(url)) {
    const res = await fetch(url);
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
  }

  const mode = storageMode();
  if (mode.kind !== 'local') {
    try {
      const res = await get(url, { access: 'private', ...sdkAuth(mode) });
      if (res && res.statusCode === 200) {
        const buffer = Buffer.from(await new Response(res.stream).arrayBuffer());
        return { buffer, contentType: res.blob.contentType ?? null };
      }
    } catch {
      // not readable with these credentials: try a plain fetch below
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
  } catch {
    return null;
  }
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

  const mode = storageMode();
  if (mode.kind !== 'local' && isBlobUrl(url)) {
    // Files of another (older) store are removed together with that store.
    await del(url, sdkAuth(mode)).catch(() => {});
  }
  // External URL (e.g. DEMO_VIDEO YouTube link) — nothing to delete from storage
}
