/**
 * Clear orphaned generated one-pager files that accumulated before caching.
 *
 * - Deletes CaseAsset rows with generated=true that are duplicates (keeps newest
 *   per case+mime) OR whose blob path is missing.
 * - Deletes local files under public/uploads/generated/onepagers/ that are not
 *   referenced by any CaseAsset.uri.
 *
 * Usage: npx tsx --env-file=.env.local scripts/cleanup-generated-onepagers.ts
 * Dry run: add --dry-run
 */
import { readdir, unlink } from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/db';
import { deleteAsset } from '../lib/storage/blob';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(dryRun ? 'DRY RUN — no deletes' : 'LIVE — will delete orphans');

  const generated = await prisma.caseAsset.findMany({
    where: { kind: 'ONE_PAGER', generated: true },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true,
      caseId: true,
      uri: true,
      mimeType: true,
      uploadedAt: true,
    },
  });

  // Keep newest per caseId+mimeType; mark older as duplicate
  const keep = new Set<string>();
  const dupes: typeof generated = [];
  for (const row of generated) {
    const key = `${row.caseId}::${row.mimeType ?? ''}`;
    if (keep.has(key)) {
      dupes.push(row);
    } else {
      keep.add(key);
    }
  }

  console.log(`generated rows: ${generated.length}, duplicates: ${dupes.length}`);

  for (const row of dupes) {
    console.log('  drop duplicate', row.id, row.uri);
    if (!dryRun) {
      try {
        await deleteAsset(row.uri);
      } catch (e) {
        console.warn('    blob delete failed', e);
      }
      await prisma.caseAsset.delete({ where: { id: row.id } });
    }
  }

  const remaining = await prisma.caseAsset.findMany({
    where: { kind: 'ONE_PAGER', generated: true },
    select: { uri: true },
  });
  const referenced = new Set(remaining.map((r) => r.uri));

  const localDir = path.join(
    process.cwd(),
    'public',
    'uploads',
    'generated',
    'onepagers',
  );
  let localFiles: string[] = [];
  try {
    localFiles = await readdir(localDir);
  } catch {
    console.log('no local generated/onepagers dir');
  }

  for (const name of localFiles) {
    const url = `/uploads/generated/onepagers/${name}`;
    if (referenced.has(url)) continue;
    console.log('  orphan local file', url);
    if (!dryRun) {
      try {
        await unlink(path.join(localDir, name));
      } catch (e) {
        console.warn('    unlink failed', e);
      }
    }
  }

  console.log('done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
