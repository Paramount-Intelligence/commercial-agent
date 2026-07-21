import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const cases = await prisma.caseStudy.findMany({
    select: {
      title: true, slug: true, tech: true, industry: true,
      overview: true, results: true, image: true,
    },
    orderBy: { title: 'asc' },
  });

  console.log(`TOTAL CASES: ${cases.length}\n`);

  // 1. Which cases still have no tech?
  const noTech = cases.filter(c => {
    const t = c.tech as any[];
    return !Array.isArray(t) || t.length === 0;
  });
  console.log(`=== CASES WITH NO TECH (${noTech.length}) ===`);
  noTech.forEach(c => console.log(`  ✗ ${c.title}`));

  // 2. Broken website fields (would break the live site)
  const broken = cases.filter(c => !c.image || !c.slug);
  console.log(`\n=== MISSING image/slug (${broken.length}) — WOULD BREAK SITE ===`);
  broken.forEach(c => console.log(`  ✗ ${c.title}`));

  // 3. Duplicate slugs / titles
  const seen = new Map<string, number>();
  cases.forEach(c => seen.set(c.title, (seen.get(c.title) ?? 0) + 1));
  const dupes = [...seen].filter(([, n]) => n > 1);
  console.log(`\n=== DUPLICATE TITLES (${dupes.length}) ===`);
  dupes.forEach(([t, n]) => console.log(`  ✗ ${t} (x${n})`));

  // 4. THE REAL TEST — is Marty's query answerable?
  const flat: string[] = [];
  for (const c of cases) {
    const items = (c.tech ?? []) as Array<{ title?: string; description?: string }>;
    if (!Array.isArray(items)) continue;
    for (const t of items) flat.push(`${t?.title ?? ''}: ${t?.description ?? ''}`);
  }
  const blob = flat.join(' | ');
  console.log(`\n=== TECH REALITY CHECK ===`);
  for (const t of ['AWS', 'n8n', 'Claude', 'OpenAI', 'Python', 'React',
                   'BigQuery', 'LangChain', 'Docker', 'postgres']) {
    const n = cases.filter(c => {
      const items = (c.tech ?? []) as any[];
      return Array.isArray(items) && items.some(i =>
        `${i?.title} ${i?.description}`.toLowerCase().includes(t.toLowerCase()));
    }).length;
    console.log(`  ${t.padEnd(12)} appears in ${n} cases`);
  }

  // 5. MARTY'S ACCEPTANCE CRITERION
  const n8nAndAws = cases.filter(c => {
    const items = (c.tech ?? []) as any[];
    if (!Array.isArray(items)) return false;
    const s = items.map(i => `${i?.title} ${i?.description}`).join(' ').toLowerCase();
    return s.includes('n8n') && s.includes('aws');
  });
  console.log(`\n=== MARTY'S QUERY: cases with BOTH n8n AND AWS → ${n8nAndAws.length} ===`);
  n8nAndAws.forEach(c => console.log(`  ✓ ${c.title}`));

  // 6. Raw sample so I can see the shape
  const sample = cases.find(c => Array.isArray(c.tech) && (c.tech as any[]).length > 0);
  console.log(`\n=== RAW SAMPLE: ${sample?.title} ===`);
  console.log(JSON.stringify(sample?.tech, null, 2));
}

main().finally(() => prisma.$disconnect());