/**
 * Attribution metadata helpers for ContentChunk ingestion (src-gate licensing).
 */
import { DELIVERED_OUTCOME_CLAIM_RE } from '../agent/srcGrounding';

/** DB / gate string values (kebab-case, matches Prisma @map). */
export type AttributionClassValue =
  | 'paramount-positioning'
  | 'paramount-delivery-outcome'
  | 'ali-personal-contract'
  | 'ali-prior-employment';

/**
 * Positioning copy that carries a quantified delivered outcome is a delivery claim
 * wearing a positioning label. Classing it `paramount-positioning` would make it
 * assertable via [[src]]; `paramount-delivery-outcome` keeps it non-assertable so
 * the claim has to come through search_cases + [[case:ID]].
 *
 * Shares DELIVERED_OUTCOME_CLAIM_RE with the runtime gate so ingestion and
 * validation cannot disagree about what counts as a delivery claim.
 */
export function classifyParamountContent(
  content: string,
): AttributionClassValue {
  return DELIVERED_OUTCOME_CLAIM_RE.test(content)
    ? 'paramount-delivery-outcome'
    : 'paramount-positioning';
}

export function parseRoleDateRange(dates: string): {
  startDate: string | null;
  endDate: string | null;
} {
  const cleaned = dates.replace(/\u2013|\u2014/g, '–').trim();
  const parts = cleaned.split(/\s*–\s*/);
  if (parts.length >= 2) {
    return {
      startDate: parts[0].trim() || null,
      endDate: parts[1].trim() || null,
    };
  }
  return { startDate: cleaned || null, endDate: null };
}

/** Slug → attribution bucket for Ali LinkedIn roles. */
export function attributionForAliRoleSlug(slug: string): AttributionClassValue {
  if (slug === 'paramount-intelligence') return 'paramount-positioning';
  if (
    slug === 'jazz' ||
    slug === 'bykea' ||
    slug === 'daraz' ||
    slug === 'bore-and-bore'
  ) {
    return 'ali-prior-employment';
  }
  // 2025–2026 independent / concurrent contracts
  return 'ali-personal-contract';
}
