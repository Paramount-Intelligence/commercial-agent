/**
 * Private knowledge bundle (docs, chunks, embeddings) for loading production
 * through POST /api/admin/knowledge/import, so no laptop connects to the
 * production database. Written by `npm run knowledge:bundle` outside the repo.
 * Embeddings are base64 float32 to keep the bundle well under the 4.5 MB
 * request limit.
 */
import { createHash } from 'crypto';
import { buildChunks } from './chunk';
import { ATTRIBUTIONS, type Attribution, type KnowledgeDocInput } from './types';

export const BUNDLE_VERSION = 1;

export type BundleDoc = KnowledgeDocInput & { chunks: Array<{ ordinal: number; embedding: string }> };

export type KnowledgeBundle = {
  version: number;
  createdAt: string;
  confidentialNames: string[];
  formerEmployers: string[];
  docs: BundleDoc[];
  /** sha256 over the docs and lists, checked on import. */
  checksum: string;
};

export function encodeVector(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString('base64');
}

export function decodeVector(s: string): number[] {
  const buf = Buffer.from(s, 'base64');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

function checksumOf(b: Omit<KnowledgeBundle, 'checksum' | 'createdAt'>): string {
  return createHash('sha256').update(JSON.stringify([b.version, b.confidentialNames, b.formerEmployers, b.docs])).digest('hex');
}

export function makeBundle(input: Omit<KnowledgeBundle, 'checksum' | 'version' | 'createdAt'>): KnowledgeBundle {
  const body = { version: BUNDLE_VERSION, ...input };
  return { ...body, createdAt: new Date().toISOString(), checksum: checksumOf(body) };
}

export type BundleCheck = { ok: true; bundle: KnowledgeBundle } | { ok: false; error: string };

/** Validate an uploaded bundle: version, checksum, fields, and one embedding per chunk the doc produces. */
export function checkBundle(raw: unknown): BundleCheck {
  const b = raw as KnowledgeBundle;
  if (!b || typeof b !== 'object' || b.version !== BUNDLE_VERSION || !Array.isArray(b.docs)) return { ok: false, error: 'not a knowledge bundle' };
  if (!Array.isArray(b.confidentialNames) || !Array.isArray(b.formerEmployers)) return { ok: false, error: 'missing lists' };
  if (checksumOf(b) !== b.checksum) return { ok: false, error: 'checksum mismatch' };
  for (const d of b.docs) {
    if (typeof d.id !== 'string' || typeof d.body !== 'string' || typeof d.contentHash !== 'string') return { ok: false, error: 'malformed doc' };
    if (!ATTRIBUTIONS.includes(d.attribution as Attribution)) return { ok: false, error: `bad attribution in ${d.id}` };
    if (d.status === 'hold') return { ok: false, error: `held doc in bundle: ${d.id}` };
    if (!Array.isArray(d.chunks) || d.chunks.length !== buildChunks(d).length) return { ok: false, error: `chunk count mismatch for ${d.id}` };
  }
  return { ok: true, bundle: b };
}
