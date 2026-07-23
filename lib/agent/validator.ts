/**
 * Anti-fabrication validator: every [[case:ID]] in a model reply must be an ID
 * actually returned by search_cases in this conversation. Pure — no DB, no model.
 *
 * CODE FLOOR (Ali-approved, 2026-07-22): this module is DETERMINISTIC application
 * code. It is NOT a PromptVersion layer and must NEVER become admin-editable.
 * Even if the editable guardrails prompt is loosened to allow free citation,
 * this validator still blocks fabricated case IDs before a reply ships or is spoken.
 */

const CASE_TAG_RE = /\[\[case:([^\]]+)\]\]/gi;

/** Extract raw IDs from [[case:ID]] tags (whitespace trimmed). Dupes preserved. */
export function extractCitedIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(CASE_TAG_RE)) {
    const id = (m[1] ?? '').trim();
    if (id) ids.push(id);
  }
  return ids;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; invalidIds: string[]; validIds: string[] };

export function validateCitations(
  replyText: string,
  retrievedIds: Set<string>,
): ValidationResult {
  const cited = extractCitedIds(replyText);
  const invalidIds = [...new Set(cited.filter((id) => !retrievedIds.has(id)))];
  if (invalidIds.length === 0) return { ok: true };
  return {
    ok: false,
    invalidIds,
    validIds: [...retrievedIds],
  };
}

export function buildRegenerateFeedback(
  invalidIds: string[],
  validIds: string[],
): string {
  const validList =
    validIds.length > 0
      ? validIds.join(', ')
      : '(none — you have not retrieved any cases yet; call search_cases first)';

  return (
    `Your last reply cited case ID(s) that were not in your search results: ${invalidIds.join(', ')}. ` +
    `You may ONLY cite these IDs from this conversation: ${validList}. ` +
    `Remove or correct those citations and do not invent cases.`
  );
}
