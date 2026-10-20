/**
 * Move stored files into the private Blob store (local or staging only; the
 * production move runs through POST /api/admin/maintenance/files).
 *
 *   npx tsx --env-file=.env.staging scripts/migrate-files-to-private.ts            dry run
 *   npx tsx --env-file=.env.staging scripts/migrate-files-to-private.ts --apply    move
 *
 * Writes an id/action CSV to EVAL_OUT (outside the repo); URLs are not printed.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { assertLocalDatabase } from '../lib/dbGuard';
import { evalOut, stamp } from './lib/paths';

async function main() {
  const target = assertLocalDatabase(process.env, { strict: true });
  const { migrateFiles } = await import('../lib/storage/migrateFiles');
  const { prisma } = await import('../lib/db');
  try {
    const apply = process.argv.includes('--apply');
    const all: Awaited<ReturnType<typeof migrateFiles>>['rows'] = [];
    for (;;) {
      const r = await migrateFiles({ apply, limit: 200 });
      all.push(...r.rows);
      if (!apply || !r.remaining) break;
    }
    const counts = all.reduce<Record<string, number>>((acc, r) => {
      acc[`${r.table}:${r.action}`] = (acc[`${r.table}:${r.action}`] ?? 0) + 1;
      return acc;
    }, {});
    const file = join(evalOut('files-migration'), `${target}-${apply ? 'apply' : 'dry'}-${stamp()}.csv`);
    writeFileSync(file, ['table,id,action,bytes', ...all.map((r) => `${r.table},${r.id},${r.action},${r.bytes ?? ''}`)].join('\n'));
    console.log(`${apply ? 'APPLIED' : 'DRY RUN'} on ${target}: ${JSON.stringify(counts)}`);
    console.log(`Report: ${file}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
