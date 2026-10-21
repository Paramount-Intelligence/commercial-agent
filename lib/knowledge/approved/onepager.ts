/**
 * One-pagers for approved-knowledge cases: the existing generator, fed from
 * the draft's sections (anonymised: the page shows "Confidential client").
 * Only Paramount's own engagements get a one-pager; founder background and
 * founder-led work are described in the reply instead.
 */
import type { OnepagerCaseInput } from '../../docgen/mapCaseToOnepager';
import { sections } from './chunk';
import type { DocMetadata } from './types';

export const ONEPAGER_ATTRIBUTION = 'paramount-delivery-outcome';

export const ONEPAGER_NOT_AVAILABLE =
  'A one-pager is available only for Paramount\'s own engagements. This work is founder background or founder-led, so describe it in the reply (with the attribution wording) instead of offering a document.';

export function onepagerInputFromDoc(doc: { id: string; title: string; body: string; metadata: DocMetadata }): OnepagerCaseInput {
  const byHeading = new Map(sections(doc.body).map((s) => [s.heading.toLowerCase(), s.text]));
  const get = (...keys: string[]) => keys.map((k) => byHeading.get(k)).find(Boolean) ?? '';
  return {
    title: doc.title,
    slug: doc.id,
    clientName: null,
    clientIndustry: doc.metadata.industry ?? null,
    industry: doc.metadata.industry ?? '',
    summary: get('overview', 'summary') || null,
    challenge: get('challenge', 'the challenge') || null,
    challenges: '',
    solution: get('solution', 'the solution'),
    benefits: '',
    results: get('results', 'outcomes', 'impact') || null,
    solutionAgents: null,
    tech: doc.metadata.tech ?? [],
  };
}
