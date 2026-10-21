/**
 * Local cache for OpenAI embeddings, used by seed and eval scripts to keep
 * API spend small and runs repeatable.
 *
 * Starts an HTTP server on 127.0.0.1 and points OPENAI_BASE_URL at it, so
 * lib/retrieval/embed.ts is used unchanged. Cache hits are served from
 * EVAL_OUT/cache/embeddings.json (outside the repo); misses are forwarded
 * upstream and every upstream request is logged to the API ledger.
 *
 *   const cache = await startEmbeddingCache('seed');
 *   await cache.prefetch(texts);   // one upstream request for all misses
 *   ...                            // embed() calls now hit the cache
 *   await cache.stop();
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server } from 'http';
import { join } from 'path';
import { logApiCall } from './apiLedger';
import { evalOut } from './paths';

const PREFETCH_BATCH = 256;

type CacheFile = Record<string, string>; // key -> base64 float32

type EmbeddingRequest = {
  model: string;
  input: string | string[];
  dimensions?: number;
  encoding_format?: 'float' | 'base64';
};

export type EmbeddingCache = {
  /** Embed every uncached text in as few upstream requests as possible. */
  prefetch(texts: string[], opts?: { model?: string; dimensions?: number }): Promise<void>;
  stats(): { hits: number; misses: number; upstreamCalls: number };
  stop(): Promise<void>;
};

function keyOf(model: string, dims: number | undefined, text: string): string {
  return createHash('sha256').update(`${model}|${dims ?? ''}|${text}`).digest('hex');
}

const toB64 = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const fromB64 = (s: string) => {
  const buf = Buffer.from(s, 'base64');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

export async function startEmbeddingCache(label: string): Promise<EmbeddingCache> {
  const apiKey = process.env.OPENAI_API_KEY;
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  const upstream = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const file = join(evalOut('cache'), 'embeddings.json');
  const cache: CacheFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let hits = 0;
  let misses = 0;
  let upstreamCalls = 0;

  async function fetchUpstream(model: string, dims: number | undefined, texts: string[]): Promise<void> {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const res = await fetch(`${upstream}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: texts, dimensions: dims, encoding_format: 'float' }),
    });
    upstreamCalls++;
    logApiCall('openai-embedding', texts.length, `${label} ${model}`);
    if (!res.ok) throw new Error(`embeddings upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    for (const row of json.data) cache[keyOf(model, dims, texts[row.index])] = toB64(row.embedding);
    writeFileSync(file, JSON.stringify(cache));
  }

  async function ensure(model: string, dims: number | undefined, texts: string[]): Promise<void> {
    const missing = [...new Set(texts.filter((t) => !cache[keyOf(model, dims, t)]))];
    misses += missing.length;
    hits += texts.length - missing.length;
    for (let i = 0; i < missing.length; i += PREFETCH_BATCH) {
      await fetchUpstream(model, dims, missing.slice(i, i + PREFETCH_BATCH));
    }
  }

  const server: Server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !req.url?.endsWith('/embeddings')) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(await readBody(req)) as EmbeddingRequest;
      const texts = Array.isArray(body.input) ? body.input : [body.input];
      await ensure(body.model, body.dimensions, texts);
      const data = texts.map((t, index) => {
        const b64 = cache[keyOf(body.model, body.dimensions, t)];
        return {
          object: 'embedding',
          index,
          embedding: body.encoding_format === 'base64' ? b64 : fromB64(b64),
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data, model: body.model, usage: { prompt_tokens: 0, total_tokens: 0 } }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } }));
    }
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

  return {
    async prefetch(texts, opts = {}) {
      const model = opts.model ?? process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
      await ensure(model, opts.dimensions ?? 1536, texts);
    },
    stats: () => ({ hits, misses, upstreamCalls }),
    stop: () =>
      new Promise<void>((ok) => {
        if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
        else process.env.OPENAI_BASE_URL = originalBaseUrl;
        server.close(() => ok());
      }),
  };
}
