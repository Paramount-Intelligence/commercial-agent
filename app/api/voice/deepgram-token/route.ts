import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { notifyJackieFailure } from '@/lib/alerts/failureAlert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60_000;
const MAX_GRANTS_PER_WINDOW = 6;
const grants = new Map<string, number[]>();

function allowed(userId: string, now = Date.now()): boolean {
  const recent = (grants.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_GRANTS_PER_WINDOW) {
    grants.set(userId, recent);
    return false;
  }
  recent.push(now);
  grants.set(userId, recent);
  return true;
}

export async function POST() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!allowed(session.agentUser.id)) {
    return NextResponse.json(
      { error: 'Too many voice connection attempts. Try again shortly.' },
      { status: 429 },
    );
  }

  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Deepgram voice listening is not configured.' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Deepgram token grant failed (${response.status}): ${detail.slice(0, 120)}`,
      );
    }
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new Error('Deepgram token grant returned no access token');
    }
    return NextResponse.json(
      { accessToken: data.access_token, expiresIn: data.expires_in ?? 30 },
      { headers: { 'Cache-Control': 'no-store, private' } },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[api/voice/deepgram-token] grant failed', {
      name: error instanceof Error ? error.name : 'unknown',
      status: reason.match(/\((\d{3})\)/)?.[1],
    });
    notifyJackieFailure({
      kind: 'stt_5xx',
      reason: reason.slice(0, 280),
      orgId: session.organization.id,
      orgName: session.organization.name,
      route: '/api/voice/deepgram-token',
    });
    return NextResponse.json(
      { error: 'Live listening is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
