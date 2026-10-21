/**
 * Cited-case display data for the chat UI (title + short blurb + public URL).
 * Shared by POST /api/chat (per reply) and GET /api/chat/history (per message).
 * Ids are approved-knowledge doc ids (KnowledgeDoc) or legacy CaseStudy ids.
 */
import { prisma } from '../db';
import { filterBuyerText } from '../safety/buyerOutput';
import { unapprovedClientNames } from '../safety/clientNames';
import { attributionWording } from '../knowledge/approved/attribution';
import { docsById } from '../knowledge/approved/catalog';
import { approvedFilterLists } from '../knowledge/approved/turn';

const SITE_BASE = 'https://www.paramountintelligence.co';

export type CitedCaseDisplay = {
  id: string;
  title: string;
  blurb: string;
  url?: string;
  /** How the work is attributed (approved knowledge), e.g. "Founder's prior role". */
  label?: string;
};

function blurbFromOverview(overview: string | null | undefined): string {
  const raw = overview?.trim();
  if (!raw || /^(n\/a|na|-)$/i.test(raw)) return '';
  const max = 150;
  if (raw.length <= max) return raw;
  const slice = raw.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + '…';
}

function caseUrlFromSlug(slug: string | null | undefined): string | undefined {
  const s = slug?.trim();
  if (!s) return undefined;
  return `${SITE_BASE}/case-studies/${s}`;
}

/** One DB round trip for any number of ids → display data keyed by id. */
export async function caseDisplayMap(
  ids: string[],
): Promise<Map<string, CitedCaseDisplay>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const approved = await approvedCaseDisplays(unique);
  const legacyIds = unique.filter((id) => !approved.has(id));
  if (legacyIds.length === 0) return approved;

  const rows = await prisma.caseStudy.findMany({
    where: { id: { in: legacyIds } },
    select: { id: true, title: true, overview: true, slug: true },
  });

  const clientNames = await unapprovedClientNames();
  const safe = (t: string) => filterBuyerText(t, { mode: 'case', clientNames });
  return new Map([
    ...approved,
    ...rows.map((r): [string, CitedCaseDisplay] => {
      const url = caseUrlFromSlug(r.slug);
      return [
        r.id,
        {
          id: r.id,
          title: safe(r.title),
          blurb: blurbFromOverview(r.overview ? safe(r.overview) : r.overview),
          ...(url ? { url } : {}),
        },
      ];
    }),
  ]);
}

/** Cards for approved-knowledge cases: title, anonymised subtitle, attribution label (no public URL). */
async function approvedCaseDisplays(ids: string[]): Promise<Map<string, CitedCaseDisplay>> {
  const docs = [...(await docsById(ids)).values()].filter((d) => d.type === 'case');
  if (docs.length === 0) return new Map();
  const lists = await approvedFilterLists();
  return new Map(
    docs.map((d) => {
      // Founder-attributed text names the employer as career context, so it is
      // judged per sentence; Paramount case text never names one.
      const mode = d.attribution === 'paramount-delivery-outcome' ? 'case' : 'reply';
      const safe = (t: string) => filterBuyerText(t, { mode, clientNames: lists.clientNames, formerEmployers: lists.formerEmployers });
      return [d.id, { id: d.id, title: safe(d.title), blurb: blurbFromOverview(safe(d.metadata.subtitle ?? '')), label: attributionWording(d.attribution).label }];
    }),
  );
}

/** Ordered display list for one message's citedIds (unknown ids kept as bare entries). */
export function casesFromMap(
  map: Map<string, CitedCaseDisplay>,
  ids: string[],
): CitedCaseDisplay[] {
  return ids.map((id) => map.get(id) ?? { id, title: '', blurb: '' });
}

/** Convenience for a single reply's cited ids. */
export async function buildCitedCases(ids: string[]): Promise<CitedCaseDisplay[]> {
  if (ids.length === 0) return [];
  const map = await caseDisplayMap(ids);
  return casesFromMap(map, ids);
}
