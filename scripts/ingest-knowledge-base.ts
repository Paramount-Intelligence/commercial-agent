/**
 * Ingest the Ali/Marty DOCX into ContentChunk (company/founder corpus).
 *
 * DRY RUN is the default and performs no embedding or database writes:
 *   npm run ingest:kb:dry
 *   npx tsx --env-file=.env.local scripts/ingest-knowledge-base.ts
 *
 * LIVE requires explicit approval and --apply:
 *   npm run ingest:kb
 *
 * This deliberately excludes the DOCX's representative-case-study section.
 * Case evidence belongs in CaseStudy/CaseChunk and must remain citation-gated.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import { prisma } from '../lib/db';
import { embed } from '../lib/retrieval/embed';

const DEFAULT_SOURCE_PATH =
  'docs/Paramount_Chatbot_Knowledge_Base_Ali_Marty - Final.docx';
const SOURCE_URL = 'knowledge-base://paramount/ali-marty-final';
const DOCUMENT_TITLE =
  'Paramount Intelligence Knowledge Base — Ali Azzam and Marty Kaufman';
const APPLY = process.argv.includes('--apply');
const sourceArgIndex = process.argv.indexOf('--source');
const sourcePath =
  sourceArgIndex >= 0
    ? process.argv[sourceArgIndex + 1] || DEFAULT_SOURCE_PATH
    : DEFAULT_SOURCE_PATH;

type SourceType = 'knowledge-base' | 'founder-bio';
type RawSection = {
  topSection: string;
  heading: string;
  content: string;
};
type Chunk = RawSection & {
  sourceType: SourceType;
  sourceUrl: string;
  title: string;
};

const COVER_RE = /PARAMOUNT INTELLIGENCE CHATBOT KNOWLEDGE BASE/i;
const EXCLUDED_CASE_SECTION_RE =
  /^9\.\s+REPRESENTATIVE PARAMOUNT INTELLIGENCE CASE STUDIES/i;
/** Section 13 (approved source references) IS ingested — LinkedIn + site URLs. */
const REFERENCES_SECTION_RE = /^13\.\s+APPROVED SOURCE REFERENCES/i;
const FOUNDER_SECTION_RE =
  /^(?:2\.|3\.|4\.|5\.|6\.|7\.|8\.)\s+/;
const ALI_PRIOR_EMPLOYER_RE =
  /^(?:Gratia\b|Jazz\b|Bykea\b|Daraz\b|Bore and Bore\b|Toptal\b|Catalant Practice Community\b)/i;
const MARTY_PRIOR_EMPLOYER_RE = /^(?:Catalant|Indie Intel)$/i;
const CONFIDENTIAL_CASE_OVERLAP_RE = /^(?:Jazz|Bykea|Daraz|Toptal)\b/i;

const ALI_BACKGROUND_NOTE =
  'Agent-facing attribution boundary: This is Ali Azzam’s professional experience/background, not a Paramount Intelligence engagement. Paramount Intelligence was founded in 2025. Do not present work from this employer as work delivered by Paramount Intelligence.';
const MARTY_BACKGROUND_NOTE =
  'Agent-facing attribution boundary: This is Marty Kaufman’s professional experience/background, not a Paramount Intelligence engagement. Do not present work from this employer as work delivered by Paramount Intelligence.';
const CONFIDENTIALITY_NOTE =
  'Agent-facing confidentiality boundary: Employer names in a founder biography may be shared as employment history, but must never be used to identify, infer, or de-anonymize a confidential client or case study.';
const REFERENCES_NOTE =
  'Agent-facing note: These are approved public verification links (website, LinkedIn, profiles). External company filings (Waters, Ecolab, Schneider, Donaldson, VEON/Jazz, Battery) are context/verification only — never treat them as Paramount case studies or invent project claims from them. Prefer search_cases for Paramount delivery evidence.';

const ALI_LINKEDIN = 'https://www.linkedin.com/in/syedaliazzam/';
const MARTY_LINKEDIN = 'https://www.linkedin.com/in/martykaufman/';
const ALI_TOPTAL =
  'https://www.toptal.com/developers/resume/syed-ali-azzam';
const SITE_HOME = 'https://paramountintelligence.co/';
const SITE_ABOUT = 'https://www.paramountintelligence.co/about-us';

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function extractNaturalSections(html: string): RawSection[] {
  const $ = cheerio.load(html);
  const sections: RawSection[] = [];
  let topSection = '';
  let heading = 'Overview';
  let lines: string[] = [];

  const flush = () => {
    const content = normalizeText(lines.join('\n'));
    lines = [];
    if (!topSection || content.length < 20) return;
    sections.push({ topSection, heading, content });
  };

  $('h1,h2,h3,h4,h5,h6,p,li').each((_index, element) => {
    const $element = $(element);
    if ($element.parents('p,li').length > 0) return;
    const text = normalizeText($element.text());
    if (!text) return;
    const tag = element.tagName.toLowerCase();

    if (tag === 'h1') {
      flush();
      topSection = text;
      heading = 'Overview';
      return;
    }
    if (tag === 'h2') {
      flush();
      heading = text;
      return;
    }
    if (/^h[3-6]$/.test(tag)) {
      lines.push(`${text}:`);
      return;
    }
    lines.push(tag === 'li' ? `- ${text}` : text);
  });
  flush();
  return sections;
}

function makeChunk(section: RawSection): Chunk {
  const notes: string[] = [];
  if (
    /^3\.\s+ALI’S PROFESSIONAL EXPERIENCE/i.test(section.topSection) &&
    ALI_PRIOR_EMPLOYER_RE.test(section.heading)
  ) {
    notes.push(ALI_BACKGROUND_NOTE);
  }
  if (/^5\.\s+ALI’S MAJOR ENTERPRISE AND INVESTMENT-FIRM CONTEXT/i.test(section.topSection)) {
    notes.push(ALI_BACKGROUND_NOTE, CONFIDENTIALITY_NOTE);
  }
  if (
    /^7\.\s+MARTY’S PROFESSIONAL BACKGROUND/i.test(section.topSection) &&
    MARTY_PRIOR_EMPLOYER_RE.test(section.heading)
  ) {
    notes.push(MARTY_BACKGROUND_NOTE);
  }
  if (CONFIDENTIAL_CASE_OVERLAP_RE.test(section.heading)) {
    notes.push(CONFIDENTIALITY_NOTE);
  }
  if (REFERENCES_SECTION_RE.test(section.topSection)) {
    notes.push(REFERENCES_NOTE);
  }

  const content = normalizeText(
    [
      `Document section: ${section.topSection}`,
      `Section heading: ${section.heading}`,
      ...notes,
      section.content,
    ].join('\n\n'),
  );

  return {
    ...section,
    sourceType: FOUNDER_SECTION_RE.test(section.topSection)
      ? 'founder-bio'
      : 'knowledge-base',
    sourceUrl: SOURCE_URL,
    title: DOCUMENT_TITLE,
    heading:
      section.heading === 'Overview'
        ? section.topSection
        : `${section.topSection} — ${section.heading}`,
    content,
  };
}

function boundaryChunk(): Chunk {
  return {
    topSection: 'Agent-facing corpus boundaries',
    heading: 'Founder history attribution and confidential-case separation',
    sourceType: 'knowledge-base',
    sourceUrl: SOURCE_URL,
    title: DOCUMENT_TITLE,
    content: [
      'Ali Azzam’s and Marty Kaufman’s pre-Paramount roles are personal professional background.',
      'Paramount Intelligence was founded in 2025. Never describe work performed for a prior employer as a Paramount Intelligence engagement.',
      CONFIDENTIALITY_NOTE,
      'Ali’s publicly shareable employment history and the separately maintained confidential case corpus are independent facts. Never combine them to infer a confidential client’s identity.',
    ].join('\n\n'),
  };
}

/**
 * High-signal contact/profile chunk so LinkedIn and site URLs retrieve
 * reliably for "how do I reach Ali/Marty" questions.
 * URLs come FIRST so short retrieval snippets still include them.
 */
function founderProfilesChunk(): Chunk {
  return {
    topSection: 'Approved founder profiles and company links',
    heading: 'Ali Azzam and Marty Kaufman — LinkedIn and company pages',
    sourceType: 'knowledge-base',
    sourceUrl: SOURCE_URL,
    title: DOCUMENT_TITLE,
    content: [
      'Approved LinkedIn and company profile links (share these URLs verbatim when asked):',
      `Ali Azzam LinkedIn: ${ALI_LINKEDIN}`,
      `Marty Kaufman LinkedIn: ${MARTY_LINKEDIN}`,
      `Ali Azzam Toptal: ${ALI_TOPTAL}`,
      `Paramount website: ${SITE_HOME}`,
      `Paramount About page: ${SITE_ABOUT}`,
      '',
      'When a user asks for Ali’s or Marty’s LinkedIn, lineage/background links, or how to find them online, paste the LinkedIn URLs above directly. Do not invent emails or phone numbers.',
      'If they want a personal email or a direct team connection, do not invent founder emails — offer to connect them via the team follow-up (capture_lead) after they consent.',
      'Marty is often the best starting point for commercial conversations; Ali leads technical discussions.',
      REFERENCES_NOTE,
    ].join('\n'),
  };
}

function assertSafetyBoundaries(fullText: string, chunks: Chunk[]): void {
  const requiredDocCaveats = [
    /Do not describe Bore and Bore as one of Asia’s largest companies unless an approved source is provided/i,
    /Do not invent a formal Catalant employment title for Ali/i,
  ];
  for (const caveat of requiredDocCaveats) {
    if (!caveat.test(fullText)) {
      throw new Error(`Required source-document caveat not found: ${caveat}`);
    }
    if (!chunks.some((chunk) => caveat.test(chunk.content))) {
      throw new Error(`Required caveat was lost during chunking: ${caveat}`);
    }
  }
  if (chunks.some((chunk) => EXCLUDED_CASE_SECTION_RE.test(chunk.topSection))) {
    throw new Error('Representative case-study content crossed into ContentChunk');
  }
  if (!chunks.some((chunk) => chunk.content.includes(ALI_BACKGROUND_NOTE))) {
    throw new Error('Ali pre-Paramount attribution boundary is missing');
  }
  const unframedAliHistory = chunks.filter(
    (chunk) =>
      ((/^3\.\s+ALI’S PROFESSIONAL EXPERIENCE/i.test(chunk.topSection) &&
        ALI_PRIOR_EMPLOYER_RE.test(chunk.heading)) ||
        /^5\.\s+ALI’S MAJOR ENTERPRISE AND INVESTMENT-FIRM CONTEXT/i.test(
          chunk.topSection,
        )) &&
      !chunk.content.includes(ALI_BACKGROUND_NOTE),
  );
  if (unframedAliHistory.length > 0) {
    throw new Error(
      `Ali background chunks lack attribution boundary: ${unframedAliHistory
        .map((chunk) => chunk.heading)
        .join(', ')}`,
    );
  }
  if (!chunks.some((chunk) => chunk.content.includes(CONFIDENTIALITY_NOTE))) {
    throw new Error('Founder-bio/confidential-case separation boundary is missing');
  }
  if (
    !chunks.some(
      (chunk) =>
        chunk.content.includes(ALI_LINKEDIN) &&
        chunk.content.includes(MARTY_LINKEDIN),
    )
  ) {
    throw new Error('Ali and Marty LinkedIn profile URLs are missing from chunks');
  }
}

async function writeChunks(chunks: Chunk[]): Promise<void> {
  const vectors = await embed(
    chunks.map(
      (chunk) => `${chunk.title}\n${chunk.heading}\n${chunk.content}`,
    ),
  );
  if (vectors.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: ${vectors.length} for ${chunks.length} chunks`,
    );
  }
  const rows = chunks.map((chunk, index) => {
    const vector = `[${vectors[index].join(',')}]`;
    return Prisma.sql`(${randomUUID()}, ${chunk.sourceType}, ${chunk.sourceUrl}, ${chunk.title}, ${chunk.heading}, ${chunk.content}, CAST(${vector} AS vector))`;
  });
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "ContentChunk" WHERE "sourceUrl" = ${SOURCE_URL}`,
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
      ? '=== APPLY: embed and replace Ali/Marty ContentChunk rows ==='
      : '=== DRY RUN: parse and print only; NO embeddings or database writes ===',
  );
  console.log(`source: ${sourcePath}`);
  console.log(`target: ContentChunk (${SOURCE_URL})\n`);

  const converted = await mammoth.convertToHtml({ path: sourcePath });
  for (const warning of converted.messages) {
    console.log(`DOCX ${warning.type}: ${warning.message}`);
  }

  const $ = cheerio.load(converted.value);
  const fullText = normalizeText($.root().text());
  const raw = extractNaturalSections(converted.value);
  const excluded = raw.filter(
    (section) =>
      COVER_RE.test(section.topSection) ||
      EXCLUDED_CASE_SECTION_RE.test(section.topSection),
  );
  const chunks = [
    boundaryChunk(),
    founderProfilesChunk(),
    ...raw
      .filter(
        (section) =>
          !COVER_RE.test(section.topSection) &&
          !EXCLUDED_CASE_SECTION_RE.test(section.topSection),
      )
      .map(makeChunk),
  ];

  assertSafetyBoundaries(fullText, chunks);

  chunks.forEach((chunk, index) => {
    const preview = chunk.content.replace(/\n/g, ' ⏎ ').slice(0, 240);
    console.log(
      `${String(index + 1).padStart(2, '0')}. [${chunk.sourceType}] ${chunk.heading}`,
    );
    console.log(`    chars: ${chunk.content.length}`);
    console.log(
      `    preview: ${preview}${chunk.content.length > 240 ? '…' : ''}`,
    );
  });

  console.log('\nExcluded from company corpus:');
  const excludedByTopSection = [...new Set(excluded.map((s) => s.topSection))];
  excludedByTopSection.forEach((section) => console.log(`  - ${section}`));
  console.log(
    '  Representative cases remain exclusively in CaseStudy/CaseChunk so citation validation cannot be bypassed.',
  );
  console.log(
    '  Section 13 approved source references ARE included (LinkedIn, site, verification links).',
  );

  console.log('\nSafety checks: PASS');
  console.log('  - Bore and Bore caveat preserved');
  console.log('  - Catalant-title caveat preserved');
  console.log('  - pre-Paramount founder work explicitly separated');
  console.log('  - founder employers cannot de-anonymize confidential cases');
  console.log(`\nTotal chunks ${APPLY ? 'written' : 'proposed'}: ${chunks.length}`);

  if (APPLY) {
    await writeChunks(chunks);
    console.log('Embedding and ContentChunk replacement complete.');
  } else {
    console.log('NO embeddings created. NO database rows changed.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
