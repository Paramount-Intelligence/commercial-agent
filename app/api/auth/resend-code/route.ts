import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readOrgAuth } from '@/lib/auth/orgAuth';
import { issueCode } from '@/lib/auth/verification';
import { sendVerificationEmail } from '@/lib/email/mailer';

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

    let body: { email?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const user = await prisma.agentUser.findUnique({
      where: { email },
      select: { id: true, organizationId: true, emailVerified: true, blocked: true },
    });
    if (!user || user.organizationId !== orgId || user.blocked) {
      // No identified user under this org — send them back to step 1
      return NextResponse.json(
        { error: 'Please complete the identify step first.' },
        { status: 400 },
      );
    }

    if (user.emailVerified) {
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
      console.error('[api/resend-code] email send failed', err);
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
    console.error('[api/resend-code] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
