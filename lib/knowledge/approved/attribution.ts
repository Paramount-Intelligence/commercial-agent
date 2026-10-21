/**
 * How each piece of work may be described, by its attribution class, and the
 * one rule for showing a client: the real name only when approved.
 */
import type { Attribution } from './types';

export type AttributionWording = {
  /** Short label for case cards and the case index. */
  label: string;
  /** Instruction for the model, quoted in the prompt and the context block. */
  rule: string;
};

const WORDING: Record<Attribution, AttributionWording> = {
  'paramount-delivery-outcome': {
    label: 'Paramount case',
    rule: 'Paramount\'s own engagement: say "we built" / "we delivered".',
  },
  'ali-personal-contract': {
    label: 'Founder-led work',
    rule:
      'Our founder\'s own contract work, not a Paramount engagement: say "our founder led" / "Ali led". Never call the client "Paramount\'s client" and never say "we built".',
  },
  'ali-prior-employment': {
    label: "Founder's prior role",
    rule:
      'Work from Ali\'s career before Paramount: say "before founding Paramount, Ali worked at ..." (as the founder background describes). Never present it as a Paramount case, client or engagement.',
  },
  'paramount-positioning': {
    label: 'Company information',
    rule: 'Company information: describe it as what Paramount does or offers; it is not evidence of delivered client work.',
  },
};

export function attributionWording(attribution: Attribution): AttributionWording {
  return WORDING[attribution];
}

/** Prompt block listing the wording rules. */
export const ATTRIBUTION_RULES_PROMPT = [
  'ATTRIBUTION (hard rule, by each document\'s attribution):',
  ...(['paramount-delivery-outcome', 'ali-personal-contract', 'ali-prior-employment'] as const).map(
    (a) => `- ${a}: ${WORDING[a].rule}`,
  ),
  '- Former employers and contracting platforms are never Paramount clients.',
  '- Name a client only when the document gives a client name; otherwise use its anonymised description.',
].join('\n');

/** The client shown to anyone: the real name only when approved, else the anonymised description. */
export function displayClient(doc: {
  clientName: string | null;
  clientNameApproved: boolean;
  anonymised?: string | null;
}): string {
  if (doc.clientNameApproved && doc.clientName?.trim()) return doc.clientName.trim();
  return doc.anonymised?.trim() || 'a confidential client';
}

/** "Production AI service ... for a PE-backed field service SaaS company" → "a PE-backed field service SaaS company". */
export function anonymisedFromSubtitle(subtitle: string | undefined): string | null {
  if (!subtitle) return null;
  const m = subtitle.replace(/\s*\([^)]*\)\s*$/, '').match(/\bfor (an? [^,;]+)$/i);
  return m ? m[1].trim() : null;
}
