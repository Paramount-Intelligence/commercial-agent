/**
 * Shared query-embedding cache for Phase 4.
 *
 * The existing LRU remains the fastest first tier. This Postgres tier lets
 * separate Vercel instances reuse an embedding without storing the buyer's
 * raw query. Cache failures are deliberately non-fatal: retrieval falls back
 * to OpenAI and the answer path remains available.
 */
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { embedQuery, normaliseQuery } from './queryEmbedding';

export const SHARED_QUERY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type CacheRow = { embedding: string };

function cacheKey(text: string): string {
  return createHash('sha256').update(normaliseQuery(text)).digest('hex');
}

function parseVector(value: string): number[] | null {
  const body = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!body) return null;
  const vector = body.split(',').map(Number);
  return vector.length === 1536 && vector.every(Number.isFinite)
    ? vector
    : null;
}

async function readShared(key: string): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<CacheRow[]>(Prisma.sql`
    SELECT "embedding"::text AS "embedding"
    FROM "QueryEmbeddingCache"
    WHERE "key" = ${key} AND "expiresAt" > CURRENT_TIMESTAMP
    LIMIT 1
  `);
  return rows[0] ? parseVector(rows[0].embedding) : null;
}

async function writeShared(key: string, vector: number[]): Promise<void> {
  const encoded = `[${vector.join(',')}]`;
  const expiresAt = new Date(Date.now() + SHARED_QUERY_CACHE_TTL_MS);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "QueryEmbeddingCache"
      ("key", "embedding", "expiresAt", "createdAt", "updatedAt")
    VALUES
      (${key}, CAST(${encoded} AS vector), ${expiresAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET
      "embedding" = EXCLUDED."embedding",
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = CURRENT_TIMESTAMP
  `);
}

const inFlight = new Map<string, Promise<{ vector: number[]; cached: boolean }>>();

export async function sharedQueryEmbedding(
  text: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ vector: number[]; cached: boolean; cacheTier: 'memory-or-upstream' | 'shared' }> {
  const key = cacheKey(text);
  const existing = inFlight.get(key);
  if (existing) {
    const result = await existing;
    return { ...result, cacheTier: 'memory-or-upstream' };
  }

  const work = (async () => {
    try {
      const hit = await readShared(key);
      if (hit) return { vector: hit, cached: true };
    } catch (error) {
      console.warn('[retrieval-cache] shared read failed; continuing', {
        name: error instanceof Error ? error.name : 'unknown',
      });
    }

    const result = await embedQuery(text, { signal: opts.signal });
    if (!opts.signal?.aborted) {
      void writeShared(key, result.vector).catch((error) => {
        console.warn('[retrieval-cache] shared write failed; continuing', {
          name: error instanceof Error ? error.name : 'unknown',
        });
      });
    }
    return result;
  })();

  inFlight.set(key, work);
  try {
    const result = await work;
    return {
      ...result,
      cacheTier: result.cached ? 'shared' : 'memory-or-upstream',
    };
  } finally {
    if (inFlight.get(key) === work) inFlight.delete(key);
  }
}
