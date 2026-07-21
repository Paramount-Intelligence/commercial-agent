/**
 * Compact case map for the system prompt — titles + techs + PE flag only.
 * Deliberately omits case IDs: citations must come from searchCases tool results.
 */
import { prisma } from '../db';

export async function buildCaseIndex(): Promise<string> {
  const cases = await prisma.caseStudy.findMany({
    select: {
      title: true,
      peBacked: true,
      techTags: { select: { name: true } },
    },
    orderBy: { title: 'asc' },
  });

  const lines = cases.map((c) => {
    const techs =
      c.techTags.length > 0
        ? c.techTags.map((t) => t.name).join(', ')
        : '—';
    const pe = c.peBacked === true ? 'yes' : 'unknown';
    return `- ${c.title} — tech: ${techs} — PE: ${pe}`;
  });

  return [
    'Known cases (search to retrieve full detail + IDs before citing):',
    ...lines,
  ].join('\n');
}
