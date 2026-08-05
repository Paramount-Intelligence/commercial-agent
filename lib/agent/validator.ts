/**
 * Anti-fabrication validator: every [[case:ID]] in a model reply must be an ID
 * actually returned by search_cases in this conversation. Pure — no DB, no model.
 *
 * Founder/company [[src:CHUNK_ID]] grounding lives in lib/agent/srcGrounding.ts
 * (separate namespace; never validates against case IDs).
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
  | {
      ok: false;
      invalidIds: string[];
      validIds: string[];
      mismatchedTitles: Array<{
        title: string;
        expectedId: string;
        citedId: string;
      }>;
    };

export function validateCitations(
  replyText: string,
  retrievedIds: Set<string>,
  retrievedCaseTitles: ReadonlyMap<string, string> = new Map(),
): ValidationResult {
  const cited = extractCitedIds(replyText);
  const invalidIds = [...new Set(cited.filter((id) => !retrievedIds.has(id)))];
  const mismatchedTitles: Array<{
    title: string;
    expectedId: string;
    citedId: string;
  }> = [];
  const lowerReply = replyText.toLowerCase();
  for (const [id, title] of retrievedCaseTitles) {
    const titleIndex = lowerReply.indexOf(title.toLowerCase());
    if (titleIndex < 0) continue;
    const nearby = replyText.slice(
      titleIndex + title.length,
      titleIndex + title.length + 220,
    );
    const [citedId] = extractCitedIds(nearby);
    if (citedId && citedId !== id) {
      mismatchedTitles.push({ title, expectedId: id, citedId });
    }
  }
  if (invalidIds.length === 0 && mismatchedTitles.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    invalidIds,
    validIds: [...retrievedIds],
    mismatchedTitles,
  };
}

export function buildRegenerateFeedback(
  invalidIds: string[],
  validIds: string[],
  mismatchedTitles: Array<{
    title: string;
    expectedId: string;
    citedId: string;
  }> = [],
): string {
  const validList =
    validIds.length > 0
      ? validIds.join(', ')
      : '(none — you have not retrieved any cases yet; call search_cases first)';

  const mismatchText =
    mismatchedTitles.length > 0
      ? ` Correct these title/citation pairs: ${mismatchedTitles
          .map(
            ({ title, expectedId, citedId }) =>
              `"${title}" requires [[case:${expectedId}]], not [[case:${citedId}]]`,
          )
          .join('; ')}.`
      : '';

  return (
    `Your last reply cited case ID(s) that were not in your search results: ${invalidIds.join(', ')}. ` +
    `You may ONLY cite these IDs from this conversation: ${validList}. ` +
    `Remove or correct those citations and do not invent cases.${mismatchText} ` +
    `Keep founder employment uncited and separate from case-study evidence.`
  );
}
