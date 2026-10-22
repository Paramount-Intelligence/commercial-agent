/**
 * Query embeddings for the request path (approved knowledge).
 *
 * - In-memory LRU per instance, keyed by the normalised question text, so a
 *   repeated question costs no API call. The question itself is embedded as
 *   written (trimmed); normalising only decides what counts as a repeat.
 * - At most 2 attempts within a 5 s ceiling (no SDK retries), so a slow or
 *   rate-limited embedding API cannot stall a turn. Ingestion keeps the
 *   batch retry policy in ./embed.ts.
 */
import OpenAI from 'openai';

export const QUERY_EMBED_ATTEMPTS = 2;
export const QUERY_EMBED_CEILING_MS = 5_000;
export const QUERY_CACHE_MAX = 500;

const DIMS = 1536;

/** Lower-case, collapse whitespace, drop surrounding punctuation. */
export function normaliseQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'“”‘’.,!?;:]+|[\s"'“”‘’.,!?;:]+$/g, '');
}

export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  get size(): number {
    return this.map.size;
  }
}

type EmbedOnce = (text: string, timeoutMs: number, signal?: AbortSignal) => Promise<number[]>;

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; error?: { code?: string } };
  if ((e?.code ?? e?.error?.code) === 'insufficient_quota') return false;
  if (e?.status !== undefined) return e.status === 429 || e.status >= 500;
  return true; // network error or timeout
}

// One client per instance, so warm instances reuse the connection (no new TLS
// handshake per question). The timeout is set per request.
let client: OpenAI | null = null;

const openAiEmbedOnce: EmbedOnce = async (text, timeoutMs, signal) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  client ??= new OpenAI({ apiKey, maxRetries: 0 });
  const res = await client.embeddings.create(
    {
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
      input: text,
      dimensions: DIMS,
    },
    { timeout: timeoutMs, maxRetries: 0, signal },
  );
  const v = res.data[0]?.embedding;
  if (!v || v.length !== DIMS) throw new Error(`Expected ${DIMS}-dim embedding`);
  return v;
};

export function createQueryEmbedder(opts: { embedOnce?: EmbedOnce; now?: () => number; max?: number } = {}) {
  const embedOnce = opts.embedOnce ?? openAiEmbedOnce;
  const now = opts.now ?? Date.now;
  const cache = new LruCache<number[]>(opts.max ?? QUERY_CACHE_MAX);
  let apiCalls = 0;

  async function embedQuery(
    text: string,
    request: { signal?: AbortSignal; ceilingMs?: number } = {},
  ): Promise<{ vector: number[]; cached: boolean }> {
    const key = normaliseQuery(text);
    const hit = cache.get(key);
    if (hit) return { vector: hit, cached: true };
    const deadline = now() + (request.ceilingMs ?? QUERY_EMBED_CEILING_MS);
    let lastErr: unknown;
    for (let attempt = 0; attempt < QUERY_EMBED_ATTEMPTS; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) break;
      try {
        apiCalls++;
        if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const vector = await embedOnce(text.trim(), remaining, request.signal);
        cache.set(key, vector);
        return { vector, cached: false };
      } catch (err) {
        lastErr = err;
        if (request.signal?.aborted || !isRetryable(err)) break;
      }
    }
    throw lastErr ?? new Error('query embedding timed out');
  }

  return { embedQuery, cacheSize: () => cache.size, apiCalls: () => apiCalls };
}

const shared = createQueryEmbedder();
export const embedQuery = shared.embedQuery;
