/**
 * Strip CR/LF and other ASCII control characters from values that will be
 * interpolated into email headers (Subject, To, From display, etc.).
 * Prevents header injection via user/model-influenced fields.
 */
export function sanitizeHeader(value: string): string {
  return value
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shared loose email-shape check used by identify + resend-code. */
export const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailFormat(value: string): boolean {
  return EMAIL_FORMAT_RE.test(value);
}
