/**
 * Org-wide OTP email budgets — blocks scripted spam-relay via /api/auth/identify
 * when an attacker has org credentials and fans out to many addresses.
 *
 * Counts EmailVerification rows created in the rolling window for users in the
 * org (each successful issueCode creates one). Per-user 60s cooldown still applies.
 */
import { prisma } from '../db';

/** Hard ceiling on verification emails an org may trigger per rolling hour. */
export const OTP_ORG_SENDS_PER_HOUR = 20;
/** Distinct recipient addresses per org per rolling hour (abuse is many new targets). */
export const OTP_ORG_DISTINCT_EMAILS_PER_HOUR = 15;
const WINDOW_MS = 60 * 60 * 1000;

export type OtpOrgBudgetResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'send_cap' | 'distinct_email_cap';
      used: number;
      limit: number;
      retryAfterSeconds: number;
    };

export async function checkOrgOtpEmailBudget(
  organizationId: string,
  /** Candidate recipient — counted toward distinct-email cap if new in-window. */
  candidateEmail: string,
): Promise<OtpOrgBudgetResult> {
  const since = new Date(Date.now() - WINDOW_MS);
  const email = candidateEmail.trim().toLowerCase();

  const recent = await prisma.emailVerification.findMany({
    where: {
      createdAt: { gt: since },
      agentUser: { organizationId },
    },
    select: {
      createdAt: true,
      agentUser: { select: { email: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (recent.length >= OTP_ORG_SENDS_PER_HOUR) {
    const oldest = recent[0]!.createdAt.getTime();
    return {
      allowed: false,
      reason: 'send_cap',
      used: recent.length,
      limit: OTP_ORG_SENDS_PER_HOUR,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000),
      ),
    };
  }

  const distinct = new Set(recent.map((r) => r.agentUser.email.toLowerCase()));
  if (!distinct.has(email) && distinct.size >= OTP_ORG_DISTINCT_EMAILS_PER_HOUR) {
    const oldestForNew = recent[0]!.createdAt.getTime();
    return {
      allowed: false,
      reason: 'distinct_email_cap',
      used: distinct.size,
      limit: OTP_ORG_DISTINCT_EMAILS_PER_HOUR,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldestForNew + WINDOW_MS - Date.now()) / 1000),
      ),
    };
  }

  return { allowed: true };
}

export const OTP_ORG_BUDGET_USER_MESSAGE =
  'Too many verification attempts for your organization. Please try again shortly.';
