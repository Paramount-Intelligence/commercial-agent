/**
 * Validation for an email address a buyer types (for example a corrected
 * address during lead capture). Rejects anything that could break headers or
 * is not a plain address.
 */
import { isEmailFormat } from '../email/sanitize';

export function validateLeadEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (/[\s\x00-\x1f\x7f<>,;:"()[\]\\]/.test(email)) return null;
  if ((email.match(/@/g) ?? []).length !== 1) return null;
  const [local, domain] = email.split('@');
  if (!local || local.length > 64 || !domain || !/\.[a-z]{2,}$/.test(domain)) return null;
  return isEmailFormat(email) ? email : null;
}
