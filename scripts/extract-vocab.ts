import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: { title: true, tech: true, industry: true, businessFunction: true },
  });

  const techCounts = new Map<string, number>();
  for (const c of cases) {
    const items = (c.tech ?? []) as Array<{ title?: string; description?: string }>;
    if (!Array.isArray(items)) continue;
    for (const t of items) {
      const name = t?.title?.trim();
      if (name) techCounts.set(name, (techCounts.get(name) ?? 0) + 1);
    }
  }

  console.log(`\n=== TECH (${techCounts.size} distinct across ${cases.length} cases) ===`);
  [...techCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, n]) => console.log(`${String(n).padStart(3)}  ${name}`));

  const uniq = (vals: (string | null)[]) =>
    [...new Set(vals.filter(Boolean) as string[])].sort();

  console.log(`\n=== INDUSTRY ===`);
  uniq(cases.map(c => c.industry)).forEach(v => console.log(`  ${v}`));

  console.log(`\n=== BUSINESS FUNCTION ===`);
  uniq(cases.map(c => c.businessFunction)).forEach(v => console.log(`  ${v}`));

  // Sanity check: what does the raw JSON actually look like?
  const sample = cases.find(c => Array.isArray(c.tech) && (c.tech as any[]).length > 0);
  console.log(`\n=== RAW SAMPLE (${sample?.title}) ===`);
  console.log(JSON.stringify(sample?.tech, null, 2)?.slice(0, 800));
}

main().finally(() => prisma.$disconnect());