/**
 * Cited-case display data for the chat UI (title + short blurb + public URL).
 * Shared by POST /api/chat (per reply) and GET /api/chat/history (per message).
 */
import { prisma } from '../db';

const SITE_BASE = 'https://www.paramountintelligence.co';

export type CitedCaseDisplay = {
  id: string;
  title: string;
  blurb: string;
  url?: string;
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

  const rows = await prisma.caseStudy.findMany({
    where: { id: { in: unique } },
    select: { id: true, title: true, overview: true, slug: true },
  });

  return new Map(
    rows.map((r) => {
      const url = caseUrlFromSlug(r.slug);
      return [
        r.id,
        {
          id: r.id,
          title: r.title,
          blurb: blurbFromOverview(r.overview),
          ...(url ? { url } : {}),
        },
      ];
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
