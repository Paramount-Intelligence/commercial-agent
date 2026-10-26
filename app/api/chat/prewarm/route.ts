import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { isConversationalNoToolsTurn } from '@/lib/agent/conversationalTurn';
import {
  approvedFilterLists,
  coreSrcChunks,
  preRetrieve,
} from '@/lib/knowledge/approved/turn';
import { assembleSystemPrompt } from '@/lib/agent/systemPrompt';

export const runtime = 'nodejs';
export const maxDuration = 5;
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60_000;
const MAX_PREWARMS_PER_WINDOW = 20;
const prewarms = new Map<string, number[]>();

function allowPrewarm(userId: string, now = Date.now()): boolean {
  const recent = (prewarms.get(userId) ?? []).filter(
    (startedAt) => now - startedAt < WINDOW_MS,
  );
  if (recent.length >= MAX_PREWARMS_PER_WINDOW) {
    prewarms.set(userId, recent);
    return false;
  }
  recent.push(now);
  prewarms.set(userId, recent);
  return true;
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!allowPrewarm(session.agentUser.id)) {
    return NextResponse.json({ error: 'Too many prewarm requests.' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const message = body.message?.trim().slice(0, 1_000);
  if (!message || isConversationalNoToolsTurn(message)) {
    return NextResponse.json({ skipped: true });
  }
  // Eager EOT is provisional, so this endpoint deliberately performs only
  // read-only work. Warm every cache the final voice turn needs in parallel;
  // TurnResumed can abort it without creating a message, consuming quota, or
  // triggering an action tool.
  const [result] = await Promise.all([
    preRetrieve(message, {
      deadlineMs: 800,
      signal: req.signal,
    }),
    assembleSystemPrompt({ voiceMode: true, omitCoreDocs: true }),
    approvedFilterLists(),
    coreSrcChunks(),
  ]);
  return NextResponse.json({
    warmed: !result.error,
    cached: result.cached,
    cacheTier: result.cacheTier,
    resultCacheHit: result.resultCacheHit,
    elapsedMs: result.totalMs,
  });
}
