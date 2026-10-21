import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readOrgAuth } from '@/lib/auth/orgAuth';
import { reissueChallenge } from '@/lib/auth/signInChallenge';
import {
  checkOrgOtpEmailBudget,
  OTP_ORG_BUDGET_USER_MESSAGE,
} from '@/lib/auth/otpEmailBudget';
import { checkLimits, clientIp, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/rateLimit';
import { sendVerificationEmail } from '@/lib/email/mailer';
import { isEmailFormat } from '@/lib/email/sanitize';

export const runtime = 'nodejs';

/** New code for a pending sign-in. Same answer whether or not one exists. */
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
    if (!isEmailFormat(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const limited = await checkLimits([
      [LIMITS.resendIp, clientIp(req)],
      [LIMITS.resendEmail, email],
    ]);
    if (!limited.allowed) {
      return NextResponse.json(
        { status: 'rate_limited', retryAfterSeconds: limited.retryAfterSeconds, error: RATE_LIMIT_MESSAGE },
        { status: 429 },
      );
    }

    const existing = await prisma.agentUser.findUnique({
      where: { email },
      select: { blocked: true },
    });
    if (existing?.blocked) {
      return NextResponse.json({ status: 'code_sent' });
    }

    const orgBudget = await checkOrgOtpEmailBudget(orgId, email);
    if (!orgBudget.allowed) {
      return NextResponse.json({
        status: 'rate_limited',
        retryAfterSeconds: orgBudget.retryAfterSeconds,
        error: OTP_ORG_BUDGET_USER_MESSAGE,
      });
    }

    const issued = await reissueChallenge({ email, orgId });
    if (!issued) {
      // No pending sign-in for this email in this org: answer as if sent.
      return NextResponse.json({ status: 'code_sent' });
    }
    if (!issued.ok) {
      return NextResponse.json({
        status: 'rate_limited',
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    try {
      await sendVerificationEmail(email, issued.code);
    } catch (err) {
      console.error('[api/resend-code] email send failed', {
        code: (err as { code?: string } | null)?.code ?? 'unknown',
      });
      await prisma.signInChallenge.updateMany({
        where: { email, organizationId: orgId, consumedAt: null },
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
