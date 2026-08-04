/**
 * Deterministic output normalizers for Jackie replies.
 * Runs in the buffer-and-gate ship path — not in prompts/guidelines.
 */

/** Spaced em dash (U+2014) in free prose → comma. */
export const EM_DASH_SPACED = ' — ';
export const EM_DASH_SPACED_REPLACEMENT = ', ';

/** Bare em dash (U+2014) → spaced hyphen. */
export const EM_DASH = '\u2014';
export const EM_DASH_REPLACEMENT = ' - ';

/** En dash (U+2013) → ASCII hyphen (ranges like 10–30). */
export const EN_DASH = '\u2013';
export const EN_DASH_REPLACEMENT = '-';

/**
 * Spans that must keep their original dashes (citations, code, URLs).
 * Extracted to placeholders before prose replacement, then restored.
 */
const PROTECTED_SPAN_RE =
  /```[\s\S]*?```|`[^`\n]+`|\[\[case:[^\]]+\]\]|https?:\/\/[^\s<>\]"'`)]+/gi;

/**
 * Strip em/en dashes from free prose only.
 * Does not touch fenced/inline code, [[case:ID]] tokens, or URLs.
 */
export function stripEmDashes(text: string): string {
  if (!text) return text;

  const placeholders: string[] = [];
  const withPlaceholders = text.replace(PROTECTED_SPAN_RE, (match) => {
    const i = placeholders.length;
    placeholders.push(match);
    return `\u0000PH${i}\u0000`;
  });

  let out = withPlaceholders
    .split(EM_DASH_SPACED)
    .join(EM_DASH_SPACED_REPLACEMENT)
    .split(EM_DASH)
    .join(EM_DASH_REPLACEMENT)
    .split(EN_DASH)
    .join(EN_DASH_REPLACEMENT)
    .replace(/ {2,}/g, ' ');

  out = out.replace(/\u0000PH(\d+)\u0000/g, (_m, idx: string) => {
    return placeholders[Number(idx)] ?? '';
  });

  return out;
}
