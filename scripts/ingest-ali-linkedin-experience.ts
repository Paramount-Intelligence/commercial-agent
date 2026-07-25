/**
 * Ingest Ali Azzam LinkedIn experience as founder-bio ContentChunks.
 *
 * One chunk per role. Replaces overlapping thinner KB founder-bio rows for the
 * same employers (section 3 experience + redundant section 5 summaries).
 *
 * DRY RUN (default — no embed / no writes):
 *   npm run ingest:ali-linkedin:dry
 *   npx tsx --env-file=.env.local scripts/ingest-ali-linkedin-experience.ts
 *
 * APPLY (after review):
 *   npm run ingest:ali-linkedin
 *   npx tsx --env-file=.env.local scripts/ingest-ali-linkedin-experience.ts --apply
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { embed } from '../lib/retrieval/embed';
import {
  ALI_LINKEDIN_ROLES,
  type LinkedInRole,
} from '../lib/knowledge/aliLinkedInRoles';

const SOURCE_URL = 'linkedin-experience://ali-azzam';
const SOURCE_TYPE = 'founder-bio';
const DOCUMENT_TITLE = 'Ali Azzam — LinkedIn professional experience';
const APPLY = process.argv.includes('--apply');

const ALI_BACKGROUND_NOTE =
  'Agent-facing attribution boundary: This is Ali Azzam’s professional experience/background, not a Paramount Intelligence engagement. Paramount Intelligence was founded in 2025. Do not present work from this employer as work delivered by Paramount Intelligence.';
const CONFIDENTIALITY_NOTE =
  'Agent-facing confidentiality boundary: Employer names in a founder biography may be shared as employment history, but must never be used to identify, infer, or de-anonymize a confidential client or case study.';
const CATALANT_CAVEAT =
  'Do not invent a formal Catalant employment title for Ali beyond Practice Community membership / AI Consultant positioning.';
const BORE_CAVEAT =
  'Do not describe Bore and Bore as one of Asia’s largest companies unless an approved source is provided.';

type ExistingChunk = {
  id: string;
  sourceUrl: string;
  title: string;
  heading: string;
  content: string;
};

type ProposedChunk = {
  sourceType: typeof SOURCE_TYPE;
  sourceUrl: typeof SOURCE_URL;
  title: string;
  heading: string;
  content: string;
  roleSlug: string;
};

type ReplacePlan = {
  roleSlug: string;
  company: string;
  replace: ExistingChunk[];
  keepNote?: string;
};

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function headingMatches(existingHeading: string, targets: string[]): boolean {
  const h = existingHeading.toLowerCase();
  return targets.some((t) => {
    const target = t.toLowerCase();
    return (
      h === target ||
      h.endsWith(`— ${target}`) ||
      h.endsWith(`- ${target}`) ||
      h.includes(target)
    );
  });
}

function sectionHeadingFromContent(content: string): string {
  return (content.match(/Section heading: ([^\n]+)/) || [])[1]?.trim() || '';
}

function documentSectionFromContent(content: string): string {
  return (content.match(/Document section: ([^\n]+)/) || [])[1]?.trim() || '';
}

function isAliExperienceOrEnterprise(content: string): boolean {
  const section = documentSectionFromContent(content);
  return (
    /ALI.?S PROFESSIONAL EXPERIENCE/i.test(section) ||
    /ALI.?S MAJOR ENTERPRISE AND INVESTMENT-FIRM CONTEXT/i.test(section)
  );
}

/**
 * Section-5 Donaldson (pricing intelligence) is DIFFERENT work from the LinkedIn
 * Donaldson role (data extraction). Keep it.
 */
function shouldKeepDespiteOverlap(chunk: ExistingChunk, role: LinkedInRole): boolean {
  if (role.slug !== 'donaldson') return false;
  const section = documentSectionFromContent(chunk.content);
  const heading = sectionHeadingFromContent(chunk.content) || chunk.heading;
  return (
    /MAJOR ENTERPRISE/i.test(section) &&
    /Donaldson/i.test(heading) &&
    /pricing/i.test(chunk.content)
  );
}

function buildRoleChunk(role: LinkedInRole): ProposedChunk {
  const notes: string[] = [];
  if (!role.isParamount) notes.push(ALI_BACKGROUND_NOTE);
  if (role.needsConfidentiality) notes.push(CONFIDENTIALITY_NOTE);
  if (role.catalantCaveat) notes.push(CATALANT_CAVEAT);
  if (role.boreCaveat) notes.push(BORE_CAVEAT);

  const lines: string[] = [
    `Person: Ali Azzam (Syed Ali Azzam)`,
    `Company: ${role.company}`,
    `Title: ${role.title}`,
    `Dates: ${role.dates}`,
  ];
  if (role.location) lines.push(`Location: ${role.location}`);
  if (role.employmentType) lines.push(`Employment type: ${role.employmentType}`);
  lines.push('');
  if (role.summary) {
    lines.push(role.summary);
    lines.push('');
  }
  if (role.bullets.length) {
    lines.push('Achievements:');
    for (const b of role.bullets) lines.push(`- ${b}`);
  }

  const content = normalizeText([...notes, lines.join('\n')].join('\n\n'));

  return {
    sourceType: SOURCE_TYPE,
    sourceUrl: SOURCE_URL,
    title: DOCUMENT_TITLE,
    heading: `${role.company} — ${role.title}`,
    content,
    roleSlug: role.slug,
  };
}

function matchReplaceTargets(
  role: LinkedInRole,
  existing: ExistingChunk[],
): ExistingChunk[] {
  const keys = [
    role.company,
    // Common aliases
    ...(role.slug === 'jazz' ? ['Jazz', 'Jazz, Part of VEON', 'Jazz and VEON'] : []),
    ...(role.slug === 'paramount-intelligence' ? ['Paramount Intelligence'] : []),
    ...(role.slug === 'catalant-practice-community'
      ? ['Catalant Practice Community', 'Catalant']
      : []),
    ...(role.slug === 'toptal-forward-deployed' ? ['Toptal'] : []),
    ...(role.slug === 'schneider-electric' ? ['Schneider Electric'] : []),
    ...(role.slug === 'donaldson' ? ['Donaldson'] : []),
    ...(role.slug === 'gratia' ? ['Gratia'] : []),
    ...(role.slug === 'bykea' ? ['Bykea'] : []),
    ...(role.slug === 'daraz'
      ? ['Daraz', 'Daraz and Alibaba', 'Daraz, an Alibaba-Backed E-Commerce Marketplace']
      : []),
    ...(role.slug === 'bore-and-bore' ? ['Bore and Bore'] : []),
  ];

  return existing.filter((chunk) => {
    if (chunk.sourceUrl === SOURCE_URL) return false; // prior linkedin ingest
    if (!isAliExperienceOrEnterprise(chunk.content)) {
      return false;
    }
    const sectionHeading = sectionHeadingFromContent(chunk.content);
    const matched =
      headingMatches(sectionHeading, keys) || headingMatches(chunk.heading, keys);
    if (!matched) return false;
    if (shouldKeepDespiteOverlap(chunk, role)) return false;
    // Catalant: only Ali's Catalant Practice Community, not Marty's Catalant role
    if (role.slug === 'catalant-practice-community') {
      return /ALI.?S PROFESSIONAL EXPERIENCE/i.test(
        documentSectionFromContent(chunk.content),
      );
    }
    // Paramount: only Ali section-3 Paramount experience, not Marty Paramount
    if (role.slug === 'paramount-intelligence') {
      return /ALI.?S PROFESSIONAL EXPERIENCE/i.test(
        documentSectionFromContent(chunk.content),
      );
    }
    return true;
  });
}

async function loadExistingFounderBio(): Promise<ExistingChunk[]> {
  return prisma.contentChunk.findMany({
    where: { sourceType: 'founder-bio' },
    select: {
      id: true,
      sourceUrl: true,
      title: true,
      heading: true,
      content: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function applyIngest(
  proposed: ProposedChunk[],
  replaceIds: string[],
): Promise<void> {
  const vectors = await embed(
    proposed.map((c) => `${c.title}\n${c.heading}\n${c.content}`),
  );
  if (vectors.length !== proposed.length) {
    throw new Error(
      `Embedding count mismatch: ${vectors.length} for ${proposed.length} chunks`,
    );
  }

  const rows = proposed.map((chunk, index) => {
    const vector = `[${vectors[index].join(',')}]`;
    return Prisma.sql`(${randomUUID()}, ${chunk.sourceType}, ${chunk.sourceUrl}, ${chunk.title}, ${chunk.heading}, ${chunk.content}, CAST(${vector} AS vector))`;
  });

  await prisma.$transaction([
    // Remove prior linkedin-experience ingest (idempotent re-run)
    prisma.$executeRaw`DELETE FROM "ContentChunk" WHERE "sourceUrl" = ${SOURCE_URL}`,
    // Remove overlapping KB role chunks
    ...(replaceIds.length
      ? [
          prisma.$executeRaw`DELETE FROM "ContentChunk" WHERE id IN (${Prisma.join(replaceIds)})`,
        ]
      : []),
    prisma.$executeRaw`
      INSERT INTO "ContentChunk"
        (id, "sourceType", "sourceUrl", title, heading, content, embedding)
      VALUES ${Prisma.join(rows)}
    `,
  ]);
}

async function main() {
  console.log(
    APPLY
      ? '=== APPLY: embed LinkedIn roles + replace overlapping founder-bio chunks ==='
      : '=== DRY RUN: proposed LinkedIn role chunks; NO embeddings or database writes ===',
  );
  console.log(`sourceType: ${SOURCE_TYPE}`);
  console.log(`sourceUrl: ${SOURCE_URL}\n`);

  const existing = await loadExistingFounderBio();

  const proposed: ProposedChunk[] = [];
  const plans: ReplacePlan[] = [];
  const replaceIdSet = new Set<string>();

  for (const role of ALI_LINKEDIN_ROLES) {
    proposed.push(buildRoleChunk(role));
    const replace = matchReplaceTargets(role, existing);
    for (const r of replace) replaceIdSet.add(r.id);

    let keepNote: string | undefined;
    if (role.slug === 'donaldson') {
      keepNote =
        'KEEP section-5 Donaldson pricing-intelligence chunk (different work than LinkedIn data-extraction role).';
    }
    if (role.slug === 'syngenta' || role.slug === 'confidential-pe-support-copilot') {
      keepNote = 'NEW role — no prior founder-bio employment chunk to replace.';
    }
    plans.push({
      roleSlug: role.slug,
      company: role.company,
      replace,
      keepNote,
    });
  }

  console.log('────────────────────────────────────────');
  console.log('PROPOSED CHUNKS (one per role)');
  console.log('────────────────────────────────────────');
  proposed.forEach((chunk, i) => {
    console.log(`\n${String(i + 1).padStart(2, '0')}. [${chunk.roleSlug}] ${chunk.heading}`);
    console.log(`    chars: ${chunk.content.length}`);
    console.log('    --- content ---');
    console.log(chunk.content);
    console.log('    --- end ---');
  });

  console.log('\n────────────────────────────────────────');
  console.log('REPLACE PLAN (overlapping KB founder-bio)');
  console.log('────────────────────────────────────────');
  let replaceCount = 0;
  for (const plan of plans) {
    console.log(`\nRole: ${plan.company} (${plan.roleSlug})`);
    if (plan.keepNote) console.log(`  note: ${plan.keepNote}`);
    if (plan.replace.length === 0) {
      console.log('  replace: (none)');
      continue;
    }
    for (const r of plan.replace) {
      replaceCount += 1;
      const sh = sectionHeadingFromContent(r.content) || r.heading;
      const section = documentSectionFromContent(r.content);
      console.log(`  REPLACE id=${r.id}`);
      console.log(`    section: ${section}`);
      console.log(`    heading: ${sh}`);
      console.log(`    chars: ${r.content.length}`);
      console.log(`    preview: ${r.content.replace(/\n/g, ' ').slice(0, 160)}…`);
    }
  }

  // Explicit keep callout for Donaldson pricing
  const donaldsonPricing = existing.filter(
    (c) =>
      /Donaldson/i.test(sectionHeadingFromContent(c.content) || c.heading) &&
      /pricing/i.test(c.content) &&
      /MAJOR ENTERPRISE/i.test(documentSectionFromContent(c.content)),
  );
  console.log('\n────────────────────────────────────────');
  console.log('EXPLICITLY KEPT (despite employer overlap)');
  console.log('────────────────────────────────────────');
  if (donaldsonPricing.length === 0) {
    console.log('  (no Donaldson pricing chunk found)');
  } else {
    for (const c of donaldsonPricing) {
      console.log(`  KEEP id=${c.id} — Donaldson pricing intelligence (section 5)`);
    }
  }

  const keptEnterprise = existing.filter((c) => {
    const section = documentSectionFromContent(c.content);
    if (!/MAJOR ENTERPRISE/i.test(section)) return false;
    const sh = sectionHeadingFromContent(c.content);
    return /Ecolab|Waters|Battery/i.test(sh);
  });
  for (const c of keptEnterprise) {
    console.log(
      `  KEEP id=${c.id} — ${sectionHeadingFromContent(c.content)} (no LinkedIn role)`,
    );
  }

  console.log('\n────────────────────────────────────────');
  console.log('TOTALS');
  console.log('────────────────────────────────────────');
  console.log(`  Proposed new chunks: ${proposed.length}`);
  console.log(`  Existing chunks to replace/delete: ${replaceIdSet.size}`);
  console.log(`  Replace listings printed: ${replaceCount}`);
  console.log(
    `  Net founder-bio delta (approx): +${proposed.length} −${replaceIdSet.size}`,
  );

  if (!APPLY) {
    console.log('\nNO embeddings created. NO database rows changed.');
    console.log('Re-run with --apply after review to embed and write.');
    return;
  }

  await applyIngest(proposed, [...replaceIdSet]);
  console.log('\nAPPLY complete: LinkedIn role chunks embedded; overlaps deleted.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
