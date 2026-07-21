import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readOrgAuth } from '@/lib/auth/orgAuth';
import { createSession } from '@/lib/auth/session';
import { issueCode } from '@/lib/auth/verification';
import { sendVerificationEmail } from '@/lib/email/mailer';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  try {
    // Org identity comes ONLY from the signed cookie — never from client input
    const orgId = await readOrgAuth();
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization login expired — please log in again.' },
        { status: 401 },
      );
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, active: true },
    });
    if (!org || !org.active) {
      return NextResponse.json(
        { error: 'Organization login expired — please log in again.' },
        { status: 401 },
      );
    }

    let body: { name?: string; email?: string; affiliation?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const affiliation = body.affiliation?.trim();
    if (!name || !email || !affiliation) {
      return NextResponse.json(
        { error: 'name, email, and affiliation are required' },
        { status: 400 },
      );
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Find-or-create by globally-unique email. Same 'code_sent' response either
    // way — never reveal whether the email already existed.
    // EDGE CASE: if an existing user belongs to a DIFFERENT org, we reassign to
    // the current org (one-user-one-org model; history follows the person).
    const user = await prisma.agentUser.upsert({
      where: { email },
      update: { name, affiliation, organizationId: org.id },
      create: {
        email,
        name,
        affiliation,
        organizationId: org.id,
        // role defaults EXTERNAL, emailVerified defaults false (schema)
      },
      select: { id: true, emailVerified: true, blocked: true },
    });

    if (user.blocked) {
      return NextResponse.json({ error: 'Access is not available.' }, { status: 403 });
    }

    // VERIFY-ONCE: already-verified users skip the code step entirely.
    // The skip path still gets a real 24h session (orgId from the cookie).
    if (user.emailVerified) {
      await createSession(user.id, org.id);
      return NextResponse.json({ status: 'already_verified' });
    }

    const issued = await issueCode(user.id);
    if (!issued.ok) {
      return NextResponse.json({
        status: 'rate_limited',
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    try {
      await sendVerificationEmail(email, issued.code);
    } catch (err) {
      console.error('[api/identify] email send failed', err);
      // Consume the just-issued code so the user can retry immediately
      // instead of hitting the 60s cooldown with no email in hand.
      await prisma.emailVerification.updateMany({
        where: { agentUserId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return NextResponse.json(
        { error: 'Could not send the verification email. Please try again.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: 'code_sent' });
  } catch (err) {
    console.error('[api/identify] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
