/**
 * Retrieval over approved knowledge: one vector query across every active
 * doc, then a noise floor, at most 2 chunks per doc, and the top 5 chunks.
 * Tech and PE signals only break near-ties between cases.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { embedQuery } from '../../retrieval/queryEmbedding';
import { normalizeProtectedEntitySpellings } from '../../agent/srcGrounding';
import { toAttribution } from './catalog';
import type { Attribution, DocMetadata } from './types';

export const SIMILARITY_FLOOR = 0.25;
/** A case gets a card only from a strong match; weaker ones (≥ the floor) are context only. */
export const CARD_SIMILARITY = 0.4;
export const TOP_CHUNKS = 5;
export const MAX_CHUNKS_PER_DOC = 2;
/** Similarities within the same 0.01 bucket count as a tie. */
const TIE_BUCKET = 0.01;
const CANDIDATES = 40;

export type ChunkHit = {
  chunkId: string;
  docId: string;
  type: string;
  title: string;
  attribution: Attribution;
  metadata: DocMetadata;
  header: string;
  content: string;
  sim: number;
};

export type RetrievalResult = {
  /** Top chunks for the context block (floor, per-doc cap, top 5). */
  chunks: ChunkHit[];
  /** Every doc above the floor, best first (for evaluation and cards). */
  rankedDocIds: string[];
  embedMs: number;
  sqlMs: number;
  cached: boolean;
};

const PE_RE = /\b(?:private[\s-]+equity|pe[\s-]+(?:backed|portfolio|firms?|funds?|owned)|portfolio compan(?:y|ies))\b/i;

/** Tech names (3+ characters) that the query names as whole words. */
export function matchedTechs(query: string, techs: string[] = []): string[] {
  const q = query.toLowerCase();
  return techs.filter((t) => {
    const name = t.toLowerCase().trim();
    return name.length >= 3 && new RegExp(`(?<![a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(q);
  });
}

/** 0–3: tech names from the case's metadata found in the query, plus 1 for a PE match. */
export function caseSignal(query: string, hit: Pick<ChunkHit, 'type' | 'metadata'>): number {
  if (hit.type !== 'case') return 0;
  const pe = PE_RE.test(query) && hit.metadata.peBacked === true ? 1 : 0;
  return Math.min(matchedTechs(query, hit.metadata.tech).length, 2) + pe;
}

/** Pure ranking over candidate chunks (any order in). */
export function rankChunks(query: string, candidates: ChunkHit[]): { chunks: ChunkHit[]; rankedDocIds: string[] } {
  const above = candidates.filter((c) => c.sim >= SIMILARITY_FLOOR);
  const keyed = above.map((c) => ({ c, bucket: Math.floor(c.sim / TIE_BUCKET), signal: caseSignal(query, c) }));
  keyed.sort((a, b) => b.bucket - a.bucket || b.signal - a.signal || b.c.sim - a.c.sim);
  const perDoc = new Map<string, number>();
  const chunks: ChunkHit[] = [];
  const rankedDocIds: string[] = [];
  for (const { c } of keyed) {
    if (!rankedDocIds.includes(c.docId)) rankedDocIds.push(c.docId);
    const n = perDoc.get(c.docId) ?? 0;
    if (n >= MAX_CHUNKS_PER_DOC || chunks.length >= TOP_CHUNKS) continue;
    perDoc.set(c.docId, n + 1);
    chunks.push(c);
  }
  return { chunks, rankedDocIds };
}

type Row = {
  chunkId: string;
  docId: string;
  type: string;
  title: string;
  attribution: string;
  metadata: DocMetadata | null;
  header: string;
  content: string;
  sim: number;
};

export async function searchApproved(
  vector: number[],
  opts: { types?: string[]; excludeTypes?: string[]; limit?: number } = {},
): Promise<ChunkHit[]> {
  const vec = `[${vector.join(',')}]`;
  const typeFilter = opts.types?.length
    ? Prisma.sql`AND d."type" IN (${Prisma.join(opts.types)})`
    : opts.excludeTypes?.length
      ? Prisma.sql`AND d."type" NOT IN (${Prisma.join(opts.excludeTypes)})`
      : Prisma.empty;
  // The query vector is parsed once (a scalar subquery): with a prepared
  // statement's generic plan, an inline CAST of the text parameter is
  // re-parsed for every row (measured ~300 ms instead of ~15 ms).
  const rows = await prisma.$queryRaw<Row[]>`
    WITH q AS MATERIALIZED (SELECT CAST(${vec} AS vector) AS v)
    SELECT c."id" AS "chunkId", c."docId", d."type", d."title", d."attribution"::text AS "attribution", d."metadata",
           c."header", c."content", 1 - (c."embedding" <=> (SELECT v FROM q)) AS "sim"
    FROM "KnowledgeChunk" c JOIN "KnowledgeDoc" d ON d."id" = c."docId"
    WHERE c."embedding" IS NOT NULL AND d."status" NOT IN ('retired', 'hold') AND d."audience" = 'buyer' ${typeFilter}
    ORDER BY c."embedding" <=> (SELECT v FROM q)
    LIMIT ${opts.limit ?? CANDIDATES}`;
  return rows.map((r) => ({ ...r, attribution: toAttribution(r.attribution), metadata: r.metadata ?? {}, sim: Number(r.sim) }));
}

export async function retrieveApproved(
  query: string,
  opts: { types?: string[]; excludeTypes?: string[] } = {},
): Promise<RetrievalResult> {
  const q = normalizeProtectedEntitySpellings(query);
  const t0 = performance.now();
  const { vector, cached } = await embedQuery(q);
  const t1 = performance.now();
  const candidates = await searchApproved(vector, opts);
  const t2 = performance.now();
  return { ...rankChunks(q, candidates), embedMs: Math.round(t1 - t0), sqlMs: Math.round(t2 - t1), cached };
}
