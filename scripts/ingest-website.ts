/**
 * Ingest Paramount's live website pages into ContentChunk (separate corpus from CaseStudy).
 *
 * DRY-RUN (default): fetch + clean + chunk, print every section for review. Writes NOTHING.
 * LIVE (--apply):    embed via lib/retrieval/embed, delete-then-insert per sourceUrl.
 *
 *   npm run ingest:site:dry
 *   npm run ingest:site
 *   npx tsx --env-file=.env.local scripts/ingest-website.ts --dry-run
 */
import { randomUUID } from 'crypto';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { embed } from '../lib/retrieval/embed';

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

// ---------------------------------------------------------------------------
// Pages to ingest (editable). Blog + case-studies intentionally excluded.
// ---------------------------------------------------------------------------

type PageSpec = {
  url: string;
  sourceType: 'about' | 'service' | 'industries' | 'candidates' | 'home';
  /**
   * Optional allowlist: keep only sections whose heading matches.
   * Used for home — CEO message + who-we-serve only.
   */
  keepHeadings?: RegExp;
};

// FAQ page intentionally excluded: client-side accordion (only 2 of ~11 Q&As
// reach SSR HTML) and candidate-facing. May be added later from source.
const PAGES: PageSpec[] = [
  { url: 'https://www.paramountintelligence.co/about-us', sourceType: 'about' },
  { url: 'https://www.paramountintelligence.co/services/ai-solutions-and-engineering', sourceType: 'service' },
  { url: 'https://www.paramountintelligence.co/services/ai-strategy-and-consulting', sourceType: 'service' },
  { url: 'https://www.paramountintelligence.co/services/data-and-analytics', sourceType: 'service' },
  { url: 'https://www.paramountintelligence.co/services/cloud-services', sourceType: 'service' },
  { url: 'https://www.paramountintelligence.co/services/ai-workflow-automation', sourceType: 'service' },
  { url: 'https://www.paramountintelligence.co/services/ai-studio-and-platform-engineering', sourceType: 'service' },
  { url: 'https://www.paramountintelligence.co/industries', sourceType: 'industries' },
  { url: 'https://www.paramountintelligence.co/for-candidates', sourceType: 'candidates' },
  {
    url: 'https://www.paramountintelligence.co/',
    sourceType: 'home',
    // CEO message + who-we-serve only — everything else on home is chrome/promos
    keepHeadings:
      /(message from our ceo|true transformation|who we work with|serving organizations)/i,
  },
];

// ---------------------------------------------------------------------------
// Cleaning rules
// ---------------------------------------------------------------------------

/** Whole line is a bare animated-counter number ("0", "50+", "100%", "0%"). */
const COUNTER_LINE_RE = /^\s*\d+\s*[+%]?\s*$/;

/** Counter label lines that ride alongside stat tiles — never real prose. */
const COUNTER_LABEL_RE =
  /^\s*(projects delivered|industries served|production[- ]ready|projects|global delivery|trusted partners|measurable roi)\s*$/i;

/** Inline "N+ Projects Delivered / N% Production-Ready" stat text. */
const INLINE_STAT_RE = /\b\d+\s*[+%]\s*(projects?|industries|production[- ]ready)/i;

/** Repeated site chrome / CTA boilerplate. */
const BOILERPLATE_RE = new RegExp(
  [
    '^(home|about us|services|industries|case studies|blog|careers|faq|contact us)$',
    "^let'?s work together$",
    '^learn about us$',
    '^explore our case studies$',
    '^(view open positions|apply now|get in touch|get started|learn more|read more|see more)$',
    '^book a (free )?(no-obligation )?consultation.*$',
    '^loading .*$',
    '^©.*$',
    '^all rights reserved.*$',
    '^privacy policy$',
    '^terms of service$',
    '^cookie.*$',
    '^we use cookies.*$',
    '^paramount intelligence - technology consulting and engineering firm$',
  ].join('|'),
  'i',
);

/** Emoji-only decorative lines (core-values icons etc.). */
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\s\u{FE0F}\u{200D}]+$/u;

function isDroppableLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (COUNTER_LINE_RE.test(t)) return true;
  if (COUNTER_LABEL_RE.test(t)) return true;
  if (INLINE_STAT_RE.test(t)) return true;
  if (BOILERPLATE_RE.test(t)) return true;
  if (EMOJI_ONLY_RE.test(t)) return true;
  return false;
}

function cleanBlock(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => !isDroppableLine(l))
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// CTA-section drop (whole sections that are contact/CTA-only, no information)
// ---------------------------------------------------------------------------

const CTA_HEADING_RE =
  /^(ready to make an impact\??|still have questions\??|get in touch|contact us|let'?s work together|ready to transform your business\??)$/i;

const CTA_CONTENT_RE =
  /(schedule a free consultation|book a free|no-obligation consultation|reach out to us|we'?ll get back to you|get in touch with us)/i;

/**
 * Trailing CTA sections: heading is a pure call-to-action, or the content is a
 * short contact pitch. Length guard keeps real prose that merely mentions a CTA.
 */
function isCtaSection(s: Section): boolean {
  if (CTA_HEADING_RE.test(s.heading.trim())) return true;
  return CTA_CONTENT_RE.test(s.content) && s.content.length < 450;
}

// ---------------------------------------------------------------------------
// Cross-page dedupe: collapse exact or >95%-identical sections to one chunk
// ---------------------------------------------------------------------------

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function wordTrigrams(text: string): Set<string> {
  const words = normalizeForCompare(text).split(' ');
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) {
    out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return out;
}

/** Dice coefficient over word trigrams — 1.0 = identical, near-identical > 0.95. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

const DEDUPE_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// Fetch + section extraction
// ---------------------------------------------------------------------------

type Section = { heading: string; content: string };

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'ParamountAgentIngest/1.0 (+internal content ingestion)' },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

/**
 * Walk the page body in document order, splitting into sections at each
 * h1–h4 heading. Paragraphs / list items / blockquotes accumulate under the
 * current heading. Chrome (nav/header/footer/script) is removed first.
 */
function extractSections(html: string): { pageTitle: string; sections: Section[] } {
  const $ = cheerio.load(html);

  // Strip chrome + non-content
  $('script, style, noscript, svg, iframe, form, nav, header, footer').remove();
  $('[class*="cookie" i], [id*="cookie" i], [aria-label*="cookie" i]').remove();

  const pageTitle =
    $('h1').first().text().replace(/\s+/g, ' ').trim() ||
    $('title').text().replace(/\s+/g, ' ').trim() ||
    'Untitled';

  const sections: Section[] = [];
  let currentHeading = pageTitle;
  let buf: string[] = [];

  function flush() {
    const content = cleanBlock(buf.join('\n'));
    buf = [];
    if (!content) return;
    const heading = cleanBlock(currentHeading) || pageTitle;
    // Merge consecutive fragments that share a heading
    const last = sections[sections.length - 1];
    if (last && last.heading === heading) {
      last.content = `${last.content}\n${content}`;
    } else {
      sections.push({ heading, content });
    }
  }

  const CONTENT_SEL = 'h1, h2, h3, h4, p, li, blockquote';
  const root = $('main').length ? $('main') : $('body');

  root.find(CONTENT_SEL).each((_i, el: AnyNode) => {
    const $el = $(el);
    // Skip elements nested inside another matched content element (e.g. p inside li)
    if ($el.parents('p, li, blockquote').length > 0) return;

    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!text) return;

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      flush();
      currentHeading = text;
    } else {
      buf.push(text);
    }
  });
  flush();

  // Drop empty/too-short sections (stray labels, chrome leftovers)
  const kept = sections.filter((s) => s.content.length >= 40);
  return { pageTitle, sections: kept };
}

// ---------------------------------------------------------------------------
// Collected chunk (post-clean, pre-dedupe) — carries its own sourceType so a
// deduped shared section can be re-marked 'service-common'.
// ---------------------------------------------------------------------------

type Chunk = {
  sourceType: string;
  sourceUrl: string;
  pageTitle: string;
  heading: string;
  content: string;
};

/**
 * Collapse exact or >95%-identical sections (Dice over word trigrams) to the
 * first occurrence. If duplicates spanned multiple service pages, the kept
 * chunk is re-marked sourceType 'service-common'.
 */
function dedupeChunks(chunks: Chunk[]): {
  kept: Chunk[];
  collapsed: Array<{ heading: string; keptUrl: string; dupUrls: string[] }>;
} {
  const kept: Chunk[] = [];
  const trigrams: Set<string>[] = [];
  const dupsByKeptIndex = new Map<number, string[]>();

  for (const chunk of chunks) {
    const grams = wordTrigrams(chunk.content);
    let matched = -1;
    for (let i = 0; i < kept.length; i++) {
      if (similarity(grams, trigrams[i]) > DEDUPE_THRESHOLD) {
        matched = i;
        break;
      }
    }
    if (matched >= 0) {
      const dups = dupsByKeptIndex.get(matched) ?? [];
      dups.push(chunk.sourceUrl);
      dupsByKeptIndex.set(matched, dups);
      const keptChunk = kept[matched];
      if (keptChunk.sourceType === 'service' && chunk.sourceType === 'service') {
        keptChunk.sourceType = 'service-common';
      }
    } else {
      kept.push({ ...chunk });
      trigrams.push(grams);
    }
  }

  const collapsed = [...dupsByKeptIndex.entries()].map(([i, dupUrls]) => ({
    heading: kept[i].heading,
    keptUrl: kept[i].sourceUrl,
    dupUrls,
  }));

  return { kept, collapsed };
}

// ---------------------------------------------------------------------------
// Write path (LIVE only)
// ---------------------------------------------------------------------------

async function writeUrlChunks(sourceUrl: string, chunks: Chunk[]): Promise<number> {
  // embed() stays OUTSIDE any transaction — network time never counts against DB budget
  const texts = chunks.map((c) => `${c.pageTitle} — ${c.heading}\n\n${c.content}`);
  const vectors = await embed(texts);
  if (vectors.length !== chunks.length) {
    throw new Error(
      `embed length mismatch for ${sourceUrl}: ${vectors.length} vs ${chunks.length}`,
    );
  }

  // ONE multi-row INSERT per URL — values are bind params (Prisma.sql tuples,
  // vectors as CAST(param AS vector)), never string-concatenated SQL.
  const valueTuples = chunks.map((c, i) => {
    const vectorStr = `[${vectors[i].join(',')}]`;
    return Prisma.sql`(${randomUUID()}, ${c.sourceType}, ${sourceUrl}, ${c.pageTitle}, ${c.heading}, ${c.content}, CAST(${vectorStr} AS vector))`;
  });

  // Batch (non-interactive) transaction: delete + single insert, atomic per URL,
  // no interactive-transaction timeout (the P2028 root cause).
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "ContentChunk" WHERE "sourceUrl" = ${sourceUrl}`,
    prisma.$executeRaw`
      INSERT INTO "ContentChunk"
        (id, "sourceType", "sourceUrl", title, heading, content, embedding)
      VALUES ${Prisma.join(valueTuples)}
    `,
  ]);

  return chunks.length;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(
    DRY
      ? '=== DRY RUN (fetch + clean + chunk only — NOTHING is embedded or written) ===\n'
      : '=== LIVE RUN (--apply): embedding and writing ContentChunk rows ===\n',
  );

  const failures: string[] = [];
  const allChunks: Chunk[] = [];
  let ctaDropped = 0;

  // Phase 1: fetch + extract + clean all pages (dedupe needs the full set)
  for (const page of PAGES) {
    console.log(`──── fetch ${page.sourceType.toUpperCase()} ${page.url}`);
    let html: string;
    try {
      html = await fetchHtml(page.url);
    } catch (err) {
      console.log(`  ✗ FETCH FAILED: ${err instanceof Error ? err.message : err}`);
      failures.push(page.url);
      continue;
    }

    const { pageTitle, sections: extracted } = extractSections(html);
    const allowed = page.keepHeadings
      ? extracted.filter(
          (s) =>
            page.keepHeadings!.test(s.heading) ||
            page.keepHeadings!.test(s.content.slice(0, 120)),
        )
      : extracted;
    const sections = allowed.filter((s) => {
      if (isCtaSection(s)) {
        ctaDropped++;
        return false;
      }
      return true;
    });

    for (const s of sections) {
      allChunks.push({
        sourceType: page.sourceType,
        sourceUrl: page.url,
        pageTitle,
        heading: s.heading,
        content: s.content,
      });
    }
  }

  // Phase 2: cross-page dedupe
  const { kept, collapsed } = dedupeChunks(allChunks);
  const collapsedCount = allChunks.length - kept.length;

  // Phase 3: report per page
  const byUrl = new Map<string, Chunk[]>();
  for (const c of kept) {
    const list = byUrl.get(c.sourceUrl) ?? [];
    list.push(c);
    byUrl.set(c.sourceUrl, list);
  }

  for (const page of PAGES) {
    if (failures.includes(page.url)) continue;
    const chunks = byUrl.get(page.url) ?? [];
    console.log(`\n──── ${page.sourceType.toUpperCase()} ${page.url}`);
    console.log(`  sections kept: ${chunks.length}`);
    if (chunks.length === 0) {
      console.log('  ⚠ zero sections after cleaning/dedupe — review this page');
      continue;
    }
    if (DRY) {
      for (const c of chunks) {
        const marker = c.sourceType === 'service-common' ? ' (service-common)' : '';
        const preview = c.content.replace(/\n/g, ' ⏎ ').slice(0, 200);
        console.log(`    [${c.heading}]${marker}`);
        console.log(`      ${preview}${c.content.length > 200 ? '…' : ''}`);
      }
    }
  }

  console.log(`\n──── dedupe: collapsed ${collapsedCount} duplicate chunk(s) into ${collapsed.length} kept chunk(s)`);
  for (const c of collapsed) {
    console.log(`    [${c.heading}] kept from ${c.keptUrl}`);
    console.log(`      duplicates dropped: ${c.dupUrls.length} (${c.dupUrls.map((u) => u.replace('https://www.paramountintelligence.co', '')).join(', ')})`);
  }
  console.log(`──── CTA sections dropped: ${ctaDropped}`);

  // Phase 4: write (LIVE only)
  let totalChunks = kept.length;
  if (!DRY) {
    totalChunks = 0;
    for (const page of PAGES) {
      if (failures.includes(page.url)) continue;
      const chunks = byUrl.get(page.url) ?? [];
      if (chunks.length === 0) {
        // Still clear stale rows so re-runs stay clean
        await prisma.$executeRaw`DELETE FROM "ContentChunk" WHERE "sourceUrl" = ${page.url}`;
        continue;
      }
      const written = await writeUrlChunks(page.url, chunks);
      totalChunks += written;
      console.log(`  ✓ ${page.url}: wrote ${written} chunk(s)`);
    }
  }

  console.log(`\n=== ${DRY ? 'DRY RUN DONE — review sections above before --apply' : 'DONE'} ===`);
  console.log(`pages:  ${PAGES.length - failures.length}/${PAGES.length} fetched`);
  console.log(`chunks ${DRY ? 'would write' : 'written'}: ${totalChunks}`);
  console.log(`duplicates collapsed: ${collapsedCount}`);
  if (failures.length > 0) {
    console.log('failed pages:');
    failures.forEach((u) => console.log(`  – ${u}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
