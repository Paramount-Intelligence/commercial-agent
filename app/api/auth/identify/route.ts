import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readOrgAuth } from '@/lib/auth/orgAuth';
import { startChallenge } from '@/lib/auth/signInChallenge';
import {
  checkOrgOtpEmailBudget,
  OTP_ORG_BUDGET_USER_MESSAGE,
} from '@/lib/auth/otpEmailBudget';
import { checkLimits, clientIp, LIMITS, RATE_LIMIT_MESSAGE } from '@/lib/auth/rateLimit';
import { sendVerificationEmail } from '@/lib/email/mailer';
import { isEmailFormat } from '@/lib/email/sanitize';

export const runtime = 'nodejs';

/**
 * Step 2 of sign-in: start a pending sign-in and email a code.
 *
 * Writes nothing about the user or organization: the name, email and
 * affiliation wait in SignInChallenge until verify-code succeeds. The answer is
 * the same for new, existing and blocked emails.
 */
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
    if (!isEmailFormat(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    // Name must be a real name — reject email-shaped values (autofill / mistaken
    // entry) so AgentUser.name is never overwritten with the email.
    if (isEmailFormat(name) || name.toLowerCase() === email) {
      return NextResponse.json(
        { error: 'Please enter your name, not an email address.' },
        { status: 400 },
      );
    }

    const limited = await checkLimits([
      [LIMITS.identifyIp, clientIp(req)],
      [LIMITS.identifyEmail, email],
      [LIMITS.identifyOrg, org.id],
    ]);
    if (!limited.allowed) {
      return NextResponse.json(
        { status: 'rate_limited', retryAfterSeconds: limited.retryAfterSeconds, error: RATE_LIMIT_MESSAGE },
        { status: 429 },
      );
    }

    // Read-only: a blocked person gets the same answer but no code.
    const existing = await prisma.agentUser.findUnique({
      where: { email },
      select: { blocked: true },
    });
    if (existing?.blocked) {
      return NextResponse.json({ status: 'code_sent' });
    }

    const orgBudget = await checkOrgOtpEmailBudget(org.id, email);
    if (!orgBudget.allowed) {
      return NextResponse.json({
        status: 'rate_limited',
        retryAfterSeconds: orgBudget.retryAfterSeconds,
        error: OTP_ORG_BUDGET_USER_MESSAGE,
      });
    }

    const issued = await startChallenge({ email, orgId: org.id, name, affiliation });
    if (!issued.ok) {
      return NextResponse.json({
        status: 'rate_limited',
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    try {
      await sendVerificationEmail(email, issued.code);
    } catch (err) {
      // No message text: SMTP errors can echo the recipient address.
      console.error('[api/identify] email send failed', {
        code: (err as { code?: string } | null)?.code ?? 'unknown',
      });
      // Consume the just-issued code so the user can retry immediately
      // instead of hitting the 60s cooldown with no email in hand.
      await prisma.signInChallenge.updateMany({
        where: { email, organizationId: org.id, consumedAt: null },
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
