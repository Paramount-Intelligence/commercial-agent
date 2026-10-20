/**
 * Shared helpers for the eval harness. Private inputs (golden questions,
 * label maps) are read from EVAL_DIR; reports are written to EVAL_OUT.
 * Both live outside the repo (scripts/lib/paths.ts).
 */
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { assertLocalDatabase } from '../../lib/dbGuard';
import { evalDir, evalOut, stamp } from '../../scripts/lib/paths';

export const BASE_URL = (process.env.EVAL_BASE_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
export const SEED_BUYER_EMAIL = 'seed-buyer@example.com';

export type GoldenQuestion = { id: string; intent: string; q: string; expected: string[] };

export function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

export function loadGolden(): GoldenQuestion[] {
  const file = join(evalDir(), 'golden-questions.yaml');
  const doc = parseYaml(readFileSync(file, 'utf8')) as { questions: GoldenQuestion[] };
  return doc.questions.map((q) => ({ ...q, expected: q.expected ?? [] }));
}

/** Guard (strict) first, then load Prisma. Returns the client and the database kind. */
export async function connect() {
  const target = assertLocalDatabase(process.env, { strict: true });
  const { prisma } = await import('../../lib/db');
  return { prisma, target };
}

type Prisma = Awaited<ReturnType<typeof connect>>['prisma'];

/** Mint a short-lived Session for the seeded buyer, as the identify route does. Returns the cookie header. */
export async function seedBuyerSession(prisma: Prisma): Promise<{ cookie: string; sessionId: string }> {
  const user = await prisma.agentUser.findUnique({ where: { email: SEED_BUYER_EMAIL } });
  if (!user?.organizationId) throw new Error(`No seeded buyer (${SEED_BUYER_EMAIL}); run npm run seed:local first.`);
  const token = randomBytes(32).toString('base64url');
  const session = await prisma.session.create({
    data: {
      token,
      agentUserId: user.id,
      organizationId: user.organizationId,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  });
  return { cookie: `session=${token}`, sessionId: session.id };
}

export type ChatResult = {
  status: number;
  ms: number;
  reply: string;
  citedIds: string[];
  citedCases: unknown[];
  attachments: unknown[];
  conversationId?: string;
  assistantMessageId?: string;
  timingMs: Record<string, number>;
  error?: string;
};

/** One /api/chat turn over HTTP (JSON, or NDJSON when streamStages is set). */
export async function chatTurn(cookie: string, message: string, voiceMode = false, conversationId?: string): Promise<ChatResult> {
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ message, voiceMode, streamStages: voiceMode, conversationId }),
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const lines = text.split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      return { raw: l.slice(0, 300) } as Record<string, unknown>;
    }
  });
  const body = (lines.find((l) => l.type === 'result') ?? (lines.length === 1 ? lines[0] : {})) as Record<string, unknown>;
  const err = lines.find((l) => l.type === 'error') ?? (res.ok ? undefined : body);
  return {
    status: res.status,
    ms,
    reply: String(body.reply ?? ''),
    citedIds: (body.citedIds as string[]) ?? [],
    citedCases: (body.citedCases as unknown[]) ?? [],
    attachments: (body.attachments as unknown[]) ?? [],
    conversationId: body.conversationId as string | undefined,
    assistantMessageId: body.assistantMessageId as string | undefined,
    timingMs: (body.timingMs as Record<string, number>) ?? {},
    error: err ? JSON.stringify(err).slice(0, 300) : undefined,
  };
}

/** Counts "[agent-loop] model call" lines a dev server wrote to --server-log since the mark. */
export function serverLogCounter(path: string | undefined) {
  const start = path && existsSync(path) ? statSync(path).size : 0;
  return () => {
    if (!path || !existsSync(path)) return null;
    const buf = readFileSync(path);
    return (buf.subarray(start).toString('utf8').match(/\[agent-loop\] model call/g) ?? []).length;
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export const median = (v: number[]) => percentile(v, 50);

/** Writes <name>-<stamp>.md (and optional .csv) to EVAL_OUT and returns the .md path. */
export function writeReport(name: string, markdown: string, csv?: string): string {
  const base = join(evalOut(), `${name}-${stamp()}`);
  writeFileSync(`${base}.md`, markdown);
  if (csv) writeFileSync(`${base}.csv`, csv);
  return `${base}.md`;
}

export const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, "'").replace(/\r?\n/g, ' ')}"`;
