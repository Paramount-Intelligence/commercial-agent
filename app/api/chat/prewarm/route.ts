import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { isConversationalNoToolsTurn } from '@/lib/agent/conversationalTurn';
import { preRetrieve } from '@/lib/knowledge/approved/turn';

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
  const result = await preRetrieve(message, {
    deadlineMs: 800,
    signal: req.signal,
  });
  return NextResponse.json({
    warmed: !result.error,
    cached: result.cached,
    elapsedMs: result.totalMs,
  });
}
