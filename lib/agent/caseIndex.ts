/**
 * Compact case map for the system prompt — titles + techs + PE flag only.
 * Deliberately omits case IDs: citations must come from searchCases tool results.
 */
import { prisma } from '../db';
import { cached } from './promptCache';
import { filterBuyerText } from '../safety/buyerOutput';
import { unapprovedClientNames } from '../safety/clientNames';

export async function buildCaseIndex(): Promise<string> {
  return cached('caseIndex', buildCaseIndexUncached);
}

async function buildCaseIndexUncached(): Promise<string> {
  const cases = await prisma.caseStudy.findMany({
    select: {
      title: true,
      peBacked: true,
      techTags: { select: { name: true } },
    },
    orderBy: { title: 'asc' },
  });

  const clientNames = await unapprovedClientNames();
  const lines = cases.map((c) => {
    const techs =
      c.techTags.length > 0
        ? c.techTags.map((t) => t.name).join(', ')
        : '—';
    const pe = c.peBacked === true ? 'yes' : 'unknown';
    const title = filterBuyerText(c.title, { mode: 'case', clientNames });
    return `- ${title} — tech: ${techs} — PE: ${pe}`;
  });

  return [
    'Known cases (search to retrieve full detail + IDs before citing):',
    ...lines,
  ].join('\n');
}
