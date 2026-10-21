/**
 * Knowledge that search_company_info must never return to the model, applied
 * at query time so production data needs no change. The full replacement of
 * the knowledge base comes later; this only removes known problem material.
 *
 * Excluded:
 * - knowledge-base sections 5 (enterprise and investment-firm context: client
 *   names stored as employers, former-employer work framed as contracts),
 *   12 (confidentiality notes that name clients) and 13 (source references
 *   that name clients);
 * - founder-bio rows whose employer is not one of the founders' real
 *   employers or platforms (drops rows where a client was stored as the
 *   employer, without listing any client here);
 * - admin-knowledge chunks of retired documents (the July 2026 company
 *   overview), which may also never be shared;
 * - the agent-facing references note appended to the founder-profiles chunk.
 */
import { prisma } from '../db';
import { adminKnowledgeSourceUrl, ADMIN_KNOWLEDGE_SOURCE_TYPE } from './ingestAdminKnowledge';

export const KB_SOURCE_URL = 'knowledge-base://paramount/ali-marty-final';
export const EXCLUDED_KB_SECTION_RE = /^\s*(?:5|12|13)\.\s/;

/** Real employers and platforms of the founders (founder background is allowed). */
export const FOUNDER_EMPLOYER_RE =
  /^\s*(?:paramount intelligence|jazz|veon|mobilink|bykea|daraz|alibaba|toptal|gratia|catalant|bore and bore|indie intel|confidential company|the event community|infinipoint|the knot|weddingwire|pwc|pricewaterhouse|hassett willis|gsa|general services administration|siebel|gibson dunn|lkc)\b/i;

/** Retired admin-knowledge documents: never searchable, never shareable. */
export const RETIRED_KNOWLEDGE_ENTRY_IDS = ['cmrxnzw8s0001ia04yprtqij8'];
export const RETIRED_KNOWLEDGE_FILE_RE = /company overview\s*-\s*july 2026/i;

const REFERENCES_NOTE_RE =
  /Agent-facing note: These are approved public verification links[\s\S]*?Prefer search_cases for Paramount delivery evidence\.\s*/g;

export type ChunkLike = {
  sourceType: string;
  sourceUrl: string;
  heading: string;
  employer: string | null;
};

export function isExcludedChunk(row: ChunkLike, retiredSourceUrls: ReadonlySet<string>): boolean {
  if (row.sourceUrl === KB_SOURCE_URL && EXCLUDED_KB_SECTION_RE.test(row.heading)) return true;
  if (row.sourceType === 'founder-bio' && row.employer?.trim() && !FOUNDER_EMPLOYER_RE.test(row.employer)) {
    return true;
  }
  if (row.sourceType === ADMIN_KNOWLEDGE_SOURCE_TYPE && retiredSourceUrls.has(row.sourceUrl)) return true;
  return false;
}

export function stripAgentNotes(content: string): string {
  return content.replace(REFERENCES_NOTE_RE, '').trim();
}

export function isRetiredKnowledgeEntry(entry: { id: string; fileName?: string | null; title?: string | null }): boolean {
  return (
    RETIRED_KNOWLEDGE_ENTRY_IDS.includes(entry.id) ||
    RETIRED_KNOWLEDGE_FILE_RE.test(entry.fileName ?? '') ||
    RETIRED_KNOWLEDGE_FILE_RE.test(entry.title ?? '')
  );
}

const TTL_MS = 5 * 60 * 1000;
let retiredCache: { at: number; urls: Set<string>; ids: Set<string> } | null = null;

/** Source URLs and ids of retired admin-knowledge entries (cached 5 minutes). */
export async function retiredKnowledge(): Promise<{ urls: Set<string>; ids: Set<string> }> {
  if (retiredCache && Date.now() - retiredCache.at < TTL_MS) return retiredCache;
  const ids = new Set(RETIRED_KNOWLEDGE_ENTRY_IDS);
  try {
    const rows = await prisma.knowledgeEntry.findMany({
      where: {
        OR: [
          { id: { in: RETIRED_KNOWLEDGE_ENTRY_IDS } },
          { fileName: { contains: 'Company Overview - July 2026', mode: 'insensitive' } },
          { title: { contains: 'Company Overview - July 2026', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    rows.forEach((r) => ids.add(r.id));
  } catch (err) {
    console.error('[knowledge/exclusions] retired lookup failed', err instanceof Error ? err.message : err);
  }
  retiredCache = { at: Date.now(), ids, urls: new Set([...ids].map(adminKnowledgeSourceUrl)) };
  return retiredCache;
}
