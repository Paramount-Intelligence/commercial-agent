/**
 * Embedding wrapper for CaseChunk / semantic search.
 * Returns 1536-dim vectors. Provider/model from env; default OpenAI
 * text-embedding-3-small. Batches requests and retries on rate limit.
 */

import OpenAI from 'openai';

const DIMS = 1536;
const BATCH_SIZE = 64;
const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'text-embedding-3-small';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: string; error?: { code?: string } };
  return e?.code ?? e?.error?.code;
}

/** Billing/quota 429s are permanent for this run — never retry. */
function isInsufficientQuota(err: unknown): boolean {
  return errorCode(err) === 'insufficient_quota';
}

function isRateLimited(err: unknown): boolean {
  // insufficient_quota arrives as 429 but is not transient
  if (isInsufficientQuota(err)) return false;
  const e = err as { status?: number };
  return (
    e?.status === 429 ||
    errorCode(err) === 'rate_limit_exceeded'
  );
}

function retryAfterMs(err: unknown, fallback: number): number {
  const e = err as { headers?: Record<string, string> };
  const raw = e?.headers?.['retry-after'] ?? e?.headers?.['Retry-After'];
  const sec = raw ? Number(raw) : NaN;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : fallback;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let delay = 1000;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isInsufficientQuota(err)) {
        throw new Error(
          'OpenAI quota/billing issue — not retrying; check platform.openai.com billing',
          { cause: err },
        );
      }
      if (!isRateLimited(err) || i === attempts - 1) throw err;
      await sleep(retryAfterMs(err, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  }
  throw new Error('embed: retry exhausted');
}

async function embedOpenAI(texts: string[], model: string): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await withRetry(() =>
      client.embeddings.create({
        model,
        input: batch,
        dimensions: DIMS,
      }),
    );

    // API returns data sorted by index; sort defensively
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) {
      if (row.embedding.length !== DIMS) {
        throw new Error(
          `Expected ${DIMS}-dim embedding, got ${row.embedding.length}`,
        );
      }
      out.push(row.embedding);
    }
  }

  return out;
}

/**
 * Embed one or more texts. Returns vectors in the same order as `texts`.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const provider = (process.env.EMBEDDING_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase();
  const model = process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL;

  if (provider === 'openai') {
    return embedOpenAI(texts, model);
  }

  throw new Error(
    `Unsupported EMBEDDING_PROVIDER "${provider}". Supported: openai`,
  );
}
