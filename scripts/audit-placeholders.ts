/**
 * READ-ONLY audit: placeholder/junk text in the CaseStudy corpus that is now
 * user-visible (card blurbs, pitches). Prints every hit with context plus
 * summary counts. Changes NOTHING.
 *
 *   npm run audit:placeholders
 *   npx tsx --env-file=.env.local scripts/audit-placeholders.ts
 */
import { prisma } from '../lib/db';

const FIELDS = [
  'title',
  'subtitle',
  'overview',
  'summary',
  'challenges',
  'solution',
  'benefits',
  'challenge',
  'client',
  'clientName',
  'keyConstraints',
  'uniqueSolution',
] as const;

type FieldName = (typeof FIELDS)[number];

type Hit = {
  caseId: string;
  caseTitle: string;
  field: FieldName;
  kind: string;
  context: string;
};

/** Generic placeholder patterns applied to every field. */
const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  // Standalone XX/XXX tokens (uppercase only — avoids ordinary words), incl.
  // "XX parent", "XX company", "XX%" etc.
  { kind: 'XX token', re: /\bX{2,5}\b/g },
  { kind: 'TODO/TBD/FIXME/PLACEHOLDER', re: /\b(TODO|TBD|FIXME|PLACEHOLDER)\b/gi },
  // Bracketed placeholders: [company], [client], [insert ...], [name], <name>, {{...}}
  {
    kind: 'bracketed placeholder',
    re: /\[(?:company|client|name|org[^\]]*|insert[^\]]*|x+)\]|<(?:company|client|name|insert[^>]*)>|\{\{[^}]*\}\}/gi,
  },
  { kind: 'lorem ipsum', re: /lorem\s+ipsum/gi },
];

/** Company-ish suffix/anchor — presence suggests a real company name. */
const COMPANY_PATTERN =
  /\b(Inc|LLC|LLP|Ltd|Limited|GmbH|Corp|Corporation|Company|Holdings|Partners|Capital|Ventures|Labs|Technologies|Tech|Systems|Software|Solutions|Bank|Health|Media|Logistics)\b\.?|&|\.com/i;

/** Words that read like an internal label rather than a client name. */
const INTERNAL_LABEL_WORDS = /\b(Team|Project|Org|Orgs|Organization|Operations)\b/;

function isTitleCaseWordSalad(value: string): boolean {
  const words = value.trim().split(/\s+/);
  if (words.length < 4) return false;
  const titleCased = words.filter((w) => /^[A-Z][a-z]+$/.test(w));
  // Nearly all words generic Title-Case (no acronyms/punctuation of a brand)
  return titleCased.length >= words.length - 1;
}

/** clientName-only heuristic: internal label rather than a company/clean descriptor. */
function clientNameSuspicion(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (COMPANY_PATTERN.test(v)) return null;
  if (INTERNAL_LABEL_WORDS.test(v)) return 'internal-label clientName';
  if (isTitleCaseWordSalad(v)) return 'title-case word salad clientName';
  return null;
}

function contextAround(text: string, index: number, matchLen: number): string {
  const radius = 60; // ~120 chars total around the match
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLen + radius);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${snippet}${end < text.length ? '…' : ''}`;
}

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: {
      id: true,
      title: true,
      subtitle: true,
      overview: true,
      summary: true,
      challenges: true,
      solution: true,
      benefits: true,
      challenge: true,
      client: true,
      clientName: true,
      keyConstraints: true,
      uniqueSolution: true,
    },
    orderBy: { title: 'asc' },
  });

  const hits: Hit[] = [];

  for (const c of cases) {
    for (const field of FIELDS) {
      const value = c[field];
      if (!value) continue;

      for (const { kind, re } of PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(value)) !== null) {
          hits.push({
            caseId: c.id,
            caseTitle: c.title,
            field,
            kind,
            context: contextAround(value, m.index, m[0].length),
          });
          // Avoid infinite loops on zero-length matches
          if (m[0].length === 0) re.lastIndex++;
        }
      }

      if (field === 'clientName') {
        const suspicion = clientNameSuspicion(value);
        if (suspicion) {
          hits.push({
            caseId: c.id,
            caseTitle: c.title,
            field,
            kind: suspicion,
            context: value.trim(),
          });
        }
      }
    }
  }

  // ---- Report ----
  console.log(`Scanned ${cases.length} CaseStudy rows across ${FIELDS.length} fields.\n`);

  if (hits.length === 0) {
    console.log('No placeholder artifacts found.');
    return;
  }

  // Group by case for readability
  const byCase = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byCase.get(h.caseId) ?? [];
    list.push(h);
    byCase.set(h.caseId, list);
  }

  for (const [caseId, caseHits] of byCase) {
    console.log('='.repeat(78));
    console.log(`CASE: ${caseHits[0].caseTitle}`);
    console.log(`  id: ${caseId}`);
    for (const h of caseHits) {
      console.log(`  [${h.field}] (${h.kind})`);
      console.log(`    ${h.context}`);
    }
    console.log('');
  }

  // Summary
  const fieldCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  for (const h of hits) {
    fieldCounts.set(h.field, (fieldCounts.get(h.field) ?? 0) + 1);
    kindCounts.set(h.kind, (kindCounts.get(h.kind) ?? 0) + 1);
  }

  console.log('='.repeat(78));
  console.log('SUMMARY');
  console.log(`  Cases with >=1 hit : ${byCase.size} of ${cases.length}`);
  console.log(`  Total hits         : ${hits.length}`);
  console.log('  By field:');
  for (const [field, count] of [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${field.padEnd(16)} ${count}`);
  }
  console.log('  By kind:');
  for (const [kind, count] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${kind.padEnd(36)} ${count}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
