import { isEmailFormat } from '../email/sanitize';

/**
 * True when a stored "name" is actually an email (browser autofill, mistaken
 * entry, or a prior overwrite). Those must not be treated as a display name.
 */
export function isEmailShapedName(
  name: string | null | undefined,
  email?: string,
): boolean {
  const n = name?.trim() || '';
  if (!n) return false;
  if (isEmailFormat(n)) return true;
  if (email && n.toLowerCase() === email.trim().toLowerCase()) return true;
  return false;
}

/** Real display name, or null when missing / email-shaped. */
export function resolveAgentUserName(
  name: string | null | undefined,
  email: string,
): string | null {
  const n = name?.trim() || '';
  if (!n || isEmailShapedName(n, email)) return null;
  return n;
}
