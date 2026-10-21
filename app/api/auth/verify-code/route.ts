import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readOrgAuth } from '@/lib/auth/orgAuth';
import { createSession } from '@/lib/auth/session';
import { checkChallenge } from '@/lib/auth/signInChallenge';
import { checkLimits, clientIp, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/rateLimit';

export const runtime = 'nodejs';

/**
 * Step 3 of sign-in: check the emailed code. Only here is the AgentUser row
 * created or updated (name, affiliation, organization) and a session minted.
 */
export async function POST(req: Request) {
  try {
    const orgId = await readOrgAuth();
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization login expired — please log in again.' },
        { status: 401 },
      );
    }

    let body: { email?: string; code?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase();
    const code = body.code?.trim();
    if (!email || !code) {
      return NextResponse.json({ error: 'email and code are required' }, { status: 400 });
    }

    const limited = await checkLimits([
      [LIMITS.verifyIp, clientIp(req)],
      [LIMITS.verifyEmail, email],
    ]);
    if (!limited.allowed) {
      return NextResponse.json(
        { ok: false, reason: 'rate_limited', retryAfterSeconds: limited.retryAfterSeconds, error: RATE_LIMIT_MESSAGE },
        { status: 429 },
      );
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { active: true },
    });
    const existing = await prisma.agentUser.findUnique({
      where: { email },
      select: { blocked: true },
    });
    if (!org?.active || existing?.blocked) {
      return NextResponse.json({ ok: false, reason: 'no_active_code' }, { status: 400 });
    }

    const result = await checkChallenge({ email, orgId, code });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: result.reason,
          ...(result.attemptsRemaining !== undefined
            ? { attemptsRemaining: result.attemptsRemaining }
            : {}),
        },
        { status: 400 },
      );
    }

    // Email ownership is proven: create or update the person, in this org.
    const user = await prisma.agentUser.upsert({
      where: { email },
      update: {
        name: result.name,
        affiliation: result.affiliation,
        organizationId: orgId,
        emailVerified: true,
      },
      create: {
        email,
        name: result.name,
        affiliation: result.affiliation,
        organizationId: orgId,
        emailVerified: true,
      },
      select: { id: true },
    });

    // Mint the 24h session — orgId comes from the verified org-auth cookie
    await createSession(user.id, orgId);

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error('[api/verify-code] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
