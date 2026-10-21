/**
 * Runtime view of approved knowledge (KNOWLEDGE_SOURCE=approved): active docs,
 * the core documents for the cached system block, the case index, and the
 * lists for the buyer-output filter. Cached with the prompt layers (30 s).
 */
import { prisma } from '../../db';
import { cached } from '../../agent/promptCache';
import { attributionWording } from './attribution';
import { formerEmployersFrom } from './employers';
import { SETTING_CONFIDENTIAL_NAMES, SETTING_FORMER_EMPLOYERS } from './store';
import type { Attribution, DocMetadata } from './types';

export type KnowledgeSource = 'approved' | 'legacy';

/** Default legacy, so a deployment keeps today's behaviour until the release sets it. */
export function knowledgeSource(env: Record<string, string | undefined> = process.env): KnowledgeSource {
  return env.KNOWLEDGE_SOURCE?.trim().toLowerCase() === 'approved' ? 'approved' : 'legacy';
}

export type ActiveDoc = {
  id: string;
  type: string;
  title: string;
  attribution: Attribution;
  clientName: string | null;
  clientNameApproved: boolean;
  metadata: DocMetadata;
  body: string;
};

/** Always in the cached system block; everything else is retrieved per turn. */
export const CORE_DOC_TYPES = new Set(['company', 'approach', 'team', 'contact', 'pricing', 'faq']);

const ACTIVE = { status: { notIn: ['retired', 'hold'] }, audience: 'buyer' };

export function toAttribution(v: string): Attribution {
  return v.replace(/_/g, '-') as Attribution;
}

export async function activeDocs(): Promise<ActiveDoc[]> {
  return cached('knowledge:activeDocs', async () => {
    const rows = await prisma.knowledgeDoc.findMany({
      where: ACTIVE,
      select: { id: true, type: true, title: true, attribution: true, clientName: true, clientNameApproved: true, metadata: true, body: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => ({ ...r, attribution: toAttribution(r.attribution), metadata: (r.metadata ?? {}) as DocMetadata }));
  });
}

export async function docsById(ids: string[]): Promise<Map<string, ActiveDoc>> {
  const all = await activeDocs();
  const want = new Set(ids);
  return new Map(all.filter((d) => want.has(d.id)).map((d) => [d.id, d]));
}

/** Core documents as one prompt block, each citable as [[src:<id>]]. */
export async function coreDocsPrompt(): Promise<{ text: string; ids: string[] }> {
  const core = (await activeDocs()).filter((d) => CORE_DOC_TYPES.has(d.type));
  const text = [
    '===== APPROVED KNOWLEDGE: CORE DOCUMENTS (cite as [[src:ID]]) =====',
    ...core.map((d) => `--- [[src:${d.id}]] ${d.title} (${d.type}; ${d.attribution}) ---\n${d.body}`),
  ].join('\n\n');
  return { text, ids: core.map((d) => d.id) };
}

/** Case index: titles of active cases only, with how each may be described. */
export async function approvedCaseIndex(): Promise<string> {
  const cases = (await activeDocs()).filter((d) => d.type === 'case');
  return [
    'Known work (retrieved evidence for the current question is attached to the user turn; cite as [[case:ID]]):',
    ...cases.map((c) => `- ${c.title} — ${attributionWording(c.attribution).label}`),
  ].join('\n');
}

export async function knowledgeLists(): Promise<{ confidentialNames: string[]; formerEmployers: string[] }> {
  return cached('knowledge:lists', async () => {
    const rows = await prisma.knowledgeSetting.findMany({ where: { key: { in: [SETTING_CONFIDENTIAL_NAMES, SETTING_FORMER_EMPLOYERS] } } });
    const get = (k: string) => {
      const v = rows.find((r) => r.key === k)?.value;
      return Array.isArray(v) ? v.map(String) : [];
    };
    const stored = get(SETTING_FORMER_EMPLOYERS);
    const formerEmployers = stored.length
      ? stored
      : formerEmployersFrom((await activeDocs()).filter((d) => d.type === 'founder-background').map((d) => d.metadata.employer));
    return { confidentialNames: get(SETTING_CONFIDENTIAL_NAMES), formerEmployers };
  });
}
