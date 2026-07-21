import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readOrgAuth } from '@/lib/auth/orgAuth';
import { createSession } from '@/lib/auth/session';
import { checkCode } from '@/lib/auth/verification';

export const runtime = 'nodejs';

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

    // User must exist AND belong to the cookie's org — orgId never from client
    const user = await prisma.agentUser.findUnique({
      where: { email },
      select: { id: true, organizationId: true, emailVerified: true, blocked: true },
    });
    if (!user || user.organizationId !== orgId || user.blocked) {
      return NextResponse.json(
        { ok: false, reason: 'no_active_code' },
        { status: 400 },
      );
    }

    if (user.emailVerified) {
      // Verified in a parallel flow — still mint the session so this tab works
      await createSession(user.id, orgId);
      return NextResponse.json({ verified: true });
    }

    const result = await checkCode(user.id, code);
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

    await prisma.agentUser.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    // Mint the 24h session — orgId comes from the verified org-auth cookie
    await createSession(user.id, orgId);

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error('[api/verify-code] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
