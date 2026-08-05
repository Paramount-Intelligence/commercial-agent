/**
 * Attribution / quarantine readiness check.
 *
 * Answers the deploy-critical question: are there existing founder-bio rows that
 * will quarantine (go silent) between migrate deploy and tagged re-ingest?
 *
 * Works BEFORE migrate (columns absent) and AFTER (class distribution).
 *
 *   npx tsx --env-file=.env.local scripts/check-attribution-columns.ts
 */
import { prisma } from '../lib/db';

async function main() {
  const founderBio = await prisma.contentChunk.count({
    where: { sourceType: 'founder-bio' },
  });
  const byType = await prisma.contentChunk.groupBy({
    by: ['sourceType'],
    _count: { _all: true },
    orderBy: { sourceType: 'asc' },
  });

  console.log('=== ContentChunk by sourceType (pre- or post-migrate) ===');
  for (const row of byType) {
    console.log(`  ${row.sourceType}: ${row._count._all}`);
  }
  console.log('');
  console.log(`founder-bio row count: ${founderBio}`);
  if (founderBio === 0) {
    console.log(
      '→ Quarantine window: NONE. No existing founder-bio rows to silence after migrate.',
    );
  } else {
    console.log(
      `→ Quarantine window: REAL (${founderBio} founder-bio rows). ` +
        'After migrate they will have attributionClass=NULL and be excluded from ' +
        'search_company_info until tagged re-ingest. Sequence migrate → ingest:ali-linkedin ' +
        '(then ingest:kb if needed) in the same maintenance pass.',
    );
  }

  const cols = await prisma.$queryRaw<
    Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
      udt_name: string;
    }>
  >`
    SELECT column_name, is_nullable, column_default, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ContentChunk'
      AND column_name IN ('attributionClass', 'employer', 'startDate', 'endDate')
    ORDER BY column_name
  `;

  console.log('\n=== attribution column metadata ===');
  if (cols.length === 0) {
    console.log(
      '  (columns not present yet — run: npx prisma migrate deploy)',
    );
    console.log(
      '  Migration is additive-nullable with no class DEFAULT; founder-bio stays NULL → quarantined.',
    );
    return;
  }

  for (const c of cols) {
    console.log(
      `  ${c.column_name}: nullable=${c.is_nullable} default=${c.column_default ?? '(none)'} type=${c.udt_name}`,
    );
  }

  const badDefault = cols.find(
    (c) =>
      c.column_name === 'attributionClass' &&
      c.column_default != null &&
      !/null/i.test(c.column_default),
  );
  if (badDefault) {
    console.error(
      '\nFAIL: attributionClass has a non-null default — would license untagged rows',
    );
    process.exitCode = 1;
    return;
  }
  const attr = cols.find((c) => c.column_name === 'attributionClass');
  if (attr && attr.is_nullable !== 'YES') {
    console.error(
      '\nFAIL: attributionClass is NOT NULL — existing rows could not stay unclassified',
    );
    process.exitCode = 1;
    return;
  }

  const quarantine = await prisma.$queryRaw<
    Array<{
      total_founder: number;
      founder_null: number;
      founder_tagged: number;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "sourceType" = 'founder-bio')::int AS total_founder,
      COUNT(*) FILTER (
        WHERE "sourceType" = 'founder-bio' AND "attributionClass" IS NULL
      )::int AS founder_null,
      COUNT(*) FILTER (
        WHERE "sourceType" = 'founder-bio' AND "attributionClass" IS NOT NULL
      )::int AS founder_tagged
    FROM "ContentChunk"
  `;
  const q = quarantine[0];
  console.log('\n=== quarantine predicate state ===');
  console.log(
    `  founder-bio total=${q?.total_founder ?? 0}  NULL/quarantined=${q?.founder_null ?? 0}  tagged=${q?.founder_tagged ?? 0}`,
  );
  console.log(
    '  Predicate: sourceType = \'founder-bio\' AND attributionClass IS NULL',
  );

  // Only founder-bio is quarantined on a null class. Every OTHER sourceType with a
  // null class still retrieves and is treated as assertable general positioning,
  // so its size is the real exposure number, not founder_null.
  const nullByType = await prisma.$queryRaw<
    Array<{ sourceType: string; nulls: number; tagged: number }>
  >`
    SELECT
      "sourceType",
      COUNT(*) FILTER (WHERE "attributionClass" IS NULL)::int AS nulls,
      COUNT(*) FILTER (WHERE "attributionClass" IS NOT NULL)::int AS tagged
    FROM "ContentChunk"
    GROUP BY "sourceType"
    ORDER BY "sourceType"
  `;

  console.log('\n=== class coverage by sourceType (null = assertable unless founder-bio) ===');
  let assertableNulls = 0;
  for (const row of nullByType) {
    const quarantined = row.sourceType === 'founder-bio';
    if (!quarantined) assertableNulls += row.nulls;
    console.log(
      `  ${row.sourceType.padEnd(18)} null=${String(row.nulls).padStart(3)} tagged=${String(
        row.tagged,
      ).padStart(3)}  ${quarantined ? '(null → QUARANTINED)' : '(null → assertable general)'}`,
    );
  }
  console.log(
    `\n  null-class rows that still license [[src]] claims: ${assertableNulls}`,
  );
  if (assertableNulls > 0) {
    console.log(
      '  These are legacy rows awaiting ingest:website / ingest:kb / admin re-ingest.\n' +
        '  They cannot assert a delivered Paramount outcome only if that sentence is\n' +
        '  caught by the case-citation rule — a null class is neither ali-* nor\n' +
        '  paramount-delivery-outcome, so class-keyed licensing does not fire on them.',
    );
  }

  if ((q?.founder_null ?? 0) > 0) {
    console.log(
      '\nACTION: founder-bio still has untagged rows. Backfill or re-ingest them.\n' +
        '  Success signal is NOT founder_null = 0 if some rows are intentionally held\n' +
        '  for manual review — compare against the backfill plan totals instead.',
    );
  } else if ((q?.total_founder ?? 0) > 0) {
    console.log('\nPASS: all founder-bio rows are tagged (quarantine window closed).');
  } else {
    console.log('\nPASS: no founder-bio rows; quarantine window is a non-event.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
