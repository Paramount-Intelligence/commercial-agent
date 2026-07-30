/**
 * Mark generated one-pager cache assets stale without deleting rows or blobs.
 *
 * The one-pager cache is fresh only when sourceUpdatedAt is non-null and at
 * least as recent as CaseStudy.updatedAt. Clearing sourceUpdatedAt therefore
 * makes the next generated one-pager request regenerate it. Historical blob
 * URLs remain valid, and admin-uploaded official assets are never mutated.
 *
 * Usage:
 *   npm run onepagers:invalidate -- --dry-run
 *   npm run onepagers:invalidate
 */
import { prisma } from '../lib/db';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const [generatedAssets, uploadedAssetsBefore] = await Promise.all([
    prisma.caseAsset.findMany({
      where: { kind: 'ONE_PAGER', generated: true },
      orderBy: [{ case: { title: 'asc' } }, { uploadedAt: 'desc' }],
      select: {
        id: true,
        caseId: true,
        mimeType: true,
        sourceUpdatedAt: true,
        case: { select: { title: true } },
      },
    }),
    prisma.caseAsset.findMany({
      where: { generated: false },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        caseId: true,
        kind: true,
        uri: true,
        sourceUpdatedAt: true,
        uploadedAt: true,
        case: { select: { title: true } },
      },
    }),
  ]);

  const caseMap = new Map<string, { title: string; assetCount: number }>();
  for (const asset of generatedAssets) {
    const current = caseMap.get(asset.caseId);
    caseMap.set(asset.caseId, {
      title: asset.case.title,
      assetCount: (current?.assetCount ?? 0) + 1,
    });
  }

  console.log(
    dryRun
      ? 'DRY RUN — no assets will be changed'
      : 'LIVE — invalidating generated one-pager cache assets',
  );
  console.log(
    `Generated cache assets selected: ${generatedAssets.length} across ${caseMap.size} cases`,
  );
  for (const [caseId, item] of caseMap) {
    console.log(`  ${caseId} | ${item.title} | ${item.assetCount} asset(s)`);
  }
  const uploadedOnepagerCount = uploadedAssetsBefore.filter(
    (asset) => asset.kind === 'ONE_PAGER',
  ).length;
  console.log(`Uploaded official one-pagers found: ${uploadedOnepagerCount}`);
  console.log(`All uploaded assets found: ${uploadedAssetsBefore.length}`);
  for (const asset of uploadedAssetsBefore) {
    console.log(
      `  preserved upload | ${asset.kind} | ${asset.case.title} | ${asset.id}`,
    );
  }
  console.log(
    'Uploaded official assets affected: 0 (generated:false is excluded)',
  );
  console.log('Blob files deleted: 0 (historical URLs are preserved)');

  if (dryRun) {
    console.log('Dry run complete — 0 rows updated');
    return;
  }

  const result = await prisma.caseAsset.updateMany({
    where: { kind: 'ONE_PAGER', generated: true },
    data: { sourceUpdatedAt: null },
  });

  const [staleGeneratedCount, freshGeneratedCount, uploadedAssetsAfter] =
    await Promise.all([
      prisma.caseAsset.count({
        where: {
          kind: 'ONE_PAGER',
          generated: true,
          sourceUpdatedAt: null,
        },
      }),
      prisma.caseAsset.count({
        where: {
          kind: 'ONE_PAGER',
          generated: true,
          sourceUpdatedAt: { not: null },
        },
      }),
      prisma.caseAsset.findMany({
        where: { generated: false },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          caseId: true,
          kind: true,
          uri: true,
          sourceUpdatedAt: true,
          uploadedAt: true,
          case: { select: { title: true } },
        },
      }),
    ]);
  const uploadedAssetsUnchanged =
    JSON.stringify(uploadedAssetsAfter) === JSON.stringify(uploadedAssetsBefore);

  console.log(`Generated cache assets invalidated: ${result.count}`);
  console.log(`Generated cache assets now stale: ${staleGeneratedCount}`);
  console.log(`Generated cache assets still fresh: ${freshGeneratedCount}`);
  console.log(
    `Uploaded assets unchanged: ${uploadedAssetsUnchanged ? uploadedAssetsAfter.length : 'FAILED'}`,
  );
  console.log(
    'Uploaded official assets affected: 0 (generated:false is excluded)',
  );
  console.log('Done — the next generated one-pager request will regenerate.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
