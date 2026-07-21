/**
 * Map CaseStudy fields → one-pager content with hard caps so EVERY case fits
 * one 13.333×7.5in slide. Only real case facts — no fabrication.
 *
 * Caps prevent overflow on wordy cases; denser extraction + layout density
 * prevent under-fill on concise ones.
 *
 * HOOK (Marty): when a client-name allowlist exists, swap unconfirmed clientName
 * values for anonymized descriptors here before they reach the template.
 */
export type OnepagerCaseInput = {
  title: string;
  slug: string;
  clientName: string | null;
  clientIndustry: string | null;
  clientMarket: string | null;
  industry: string;
  summary: string | null;
  challenge: string | null;
  challenges: string;
  solution: string;
  benefits: string;
  results: string | null;
  uniqueSolution?: string | null;
  solutionAgents: unknown;
  tech: unknown;
};

export type OnepagerContent = {
  title: string;
  client: string;
  industry: string;
  market: string;
  summary: string;
  challenge: string;
  solutionBullets: string[];
  outcomeBullets: string[];
  /** Optional differentiator — only when columns are thin and field exists. */
  uniqueLine: string;
  techItems: string[];
  /** Template hint: roomy spacing when content is short; tight when wordy. */
  density: 'roomy' | 'balanced' | 'tight';
  slug: string;
};

const SUMMARY_CAP = 320;
/** ~2–4 sentences; raised so concise cases aren't left with a single thin line. */
const CHALLENGE_CAP = 490;
const BULLET_CAP = 130;
const MAX_BULLETS = 5;
const MAX_TECH = 10;
const UNIQUE_CAP = 220;

/** Scaffolding lines that introduce a bullet list — drop these. */
const INTRO_SCAFFOLD =
  /^(?:the\s+)?(?:solution|platform|system|architecture|key\s+outcomes?|outcomes?|benefits?|results?|key\s+differentiators?)\s+(?:included|include|supported|supports|were|was|are|is|transformed|established|combined|implemented)[:\s].*$/i;

const CHALLENGE_INTRO_SCAFFOLD =
  /^(?:several\s+(?:technical\s+and\s+operational\s+)?challenges?\s+(?:emerged|increased|included)\b.*|challenges?\s+included\b.*|key\s+challenges?\s+included\b.*)$/i;

const CATEGORY_PREFIX =
  /^(?:core\s+architecture|retrieval(?:-augmented)?(?:\s+generation)?(?:\s*\(rag\))?|governance\s+workflow|role-based\s+access(?:\s+control)?|languages?\s*&\s*frameworks|ai\s*&\s*orchestration|cloud\s+infrastructure|devops\s*&\s*deployment|security\s*&\s*governance|retrieval\s*&\s*memory)\s*:\s*/i;

function collapseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Prefer a finished thought: last sentence/clause that fits under `max`.
 * Never cut mid-word. Only fall back to word-boundary + "…" if the first
 * sentence alone exceeds the cap.
 */
function trimAtThought(text: string, max: number): string {
  const t = collapseWs(text);
  if (!t) return '';
  if (t.length <= max) return t;

  const within = t.slice(0, max + 1);
  const sentenceEnds: number[] = [];
  for (let i = 0; i < within.length; i++) {
    const ch = within[i];
    if ((ch === '.' || ch === '!' || ch === '?') && i < max) {
      const next = within[i + 1];
      if (!next || /\s/.test(next)) sentenceEnds.push(i + 1);
    }
  }
  if (sentenceEnds.length > 0) {
    return t.slice(0, sentenceEnds[sentenceEnds.length - 1]).trim();
  }

  const clauseMatch = within.slice(0, max).match(/^[\s\S]*[;:—–]/);
  if (clauseMatch && clauseMatch[0].length > max * 0.5) {
    return clauseMatch[0].trim();
  }

  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.45 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd().replace(/[,;:.\-–—]+$/, '') + '…';
}

/** Pack complete sentences up to `max` (prefer fuller challenge/summary blocks). */
function trimToSentences(text: string, max: number): string {
  const t = collapseWs(text);
  if (!t) return '';
  if (t.length <= max) return t;

  const sentences = t.split(/(?<=[.!?])\s+/).map(collapseWs).filter(Boolean);
  let acc = '';
  for (const s of sentences) {
    const next = acc ? `${acc} ${s}` : s;
    if (next.length > max) break;
    acc = next;
  }
  if (acc.length >= Math.min(max * 0.4, 100)) return acc;
  return trimAtThought(t, max);
}

function stripBulletPrefix(s: string): string {
  return s
    .replace(/^[\s•\-\*▪▸►]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(CATEGORY_PREFIX, '')
    .trim();
}

function isScaffold(s: string): boolean {
  const t = collapseWs(s);
  if (!t) return true;
  if (INTRO_SCAFFOLD.test(t) && t.length < 120) return true;
  if (CHALLENGE_INTRO_SCAFFOLD.test(t)) return true;
  if (/^.+:\s*$/.test(t)) return true;
  if (
    /^(?:the\s+)?(?:solution|platform|key\s+outcomes?)\s+(?:included|supported|were)[:\s]*$/i.test(
      t
    )
  )
    return true;
  return false;
}

function isPlaceholder(s: string | null | undefined): boolean {
  if (!s?.trim()) return true;
  const t = s.trim();
  return /^(n\/?a|none|tbd|todo|placeholder|\.+)$/i.test(t);
}

/**
 * Split messy prose that may contain embedded • markers, newlines, or
 * "Label: intro • a • b" into clean standalone phrases.
 */
function extractCleanBullets(raw: string, max: number): string[] {
  if (!raw?.trim()) return [];

  const hasEmbedded =
    /[•▪▸►]/.test(raw) ||
    /^\s*[-*]\s+/m.test(raw) ||
    /^\s*\d+[.)]\s+/m.test(raw);

  let parts: string[] = [];

  if (hasEmbedded) {
    parts = raw
      .split(/\r?\n|(?=[•▪▸►])|(?:^|\n)\s*[-*]\s+|(?:^|\n)\s*\d+[.)]\s+/)
      .map(stripBulletPrefix)
      .map(collapseWs)
      .filter(Boolean);

    const expanded: string[] = [];
    for (const p of parts) {
      if ((p.match(/•/g) || []).length >= 1) {
        expanded.push(
          ...p
            .split(/•/)
            .map(stripBulletPrefix)
            .map(collapseWs)
            .filter(Boolean)
        );
      } else {
        expanded.push(p);
      }
    }
    parts = expanded;
  } else {
    parts = collapseWs(raw)
      .split(/(?<=[.!?])\s+/)
      .map(collapseWs)
      .filter((s) => s.length > 8);
  }

  const cleaned = parts
    .map(stripBulletPrefix)
    .map((s) => s.replace(/^[^:]{2,40}:\s+(?=The\s+)/i, ''))
    .map(collapseWs)
    .filter((s) => !isScaffold(s))
    .filter((s) => s.length >= 12)
    .map((s) => {
      if (hasEmbedded && s.length > BULLET_CAP) {
        const first = s.split(/(?<=[.!?])\s+/)[0] || s;
        return trimAtThought(first, BULLET_CAP);
      }
      return trimAtThought(s, BULLET_CAP);
    })
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of cleaned) {
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length >= max) break;
  }
  return out;
}

function agentsToBullets(agents: unknown, max: number): string[] {
  if (!Array.isArray(agents)) return [];

  const chunks: string[] = [];
  for (const a of agents) {
    if (!a || typeof a !== 'object') continue;
    const row = a as { title?: unknown; description?: unknown };
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const desc = typeof row.description === 'string' ? row.description.trim() : '';
    if (desc) chunks.push(desc);
    else if (title) chunks.push(title);
  }

  if (chunks.length === 0) return [];

  const fromEmbedded = extractCleanBullets(chunks.join('\n'), max);
  if (fromEmbedded.length > 0) return fromEmbedded;

  const out: string[] = [];
  for (const a of agents) {
    if (!a || typeof a !== 'object') continue;
    const row = a as { title?: unknown; description?: unknown };
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const desc = typeof row.description === 'string' ? row.description.trim() : '';
    const text = title && desc ? `${title}: ${desc}` : title || desc;
    if (text) out.push(trimAtThought(text, BULLET_CAP));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Build a fuller challenge paragraph from prose that may wrap a bullet list.
 * Prefers intro + outro sentences; folds a few short challenge items when
 * that still fits under the cap (keeps concise cases from looking thin).
 */
function mapChallenge(raw: string, max: number): string {
  const src = raw.trim();
  if (!src) return '';

  const hasEmbedded =
    /[•▪▸►]/.test(src) || /^\s*[-*]\s+/m.test(src) || /^\s*\d+[.)]\s+/m.test(src);

  if (!hasEmbedded) {
    return trimToSentences(src, max);
  }

  const lines = src.split(/\r?\n/);
  const bulletIdxs: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*[•▪▸►]/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
      bulletIdxs.push(i);
    }
  });

  const firstBullet = bulletIdxs[0] ?? -1;
  const lastBullet = bulletIdxs[bulletIdxs.length - 1] ?? -1;

  const introRaw =
    firstBullet >= 0 ? lines.slice(0, firstBullet).join(' ') : src;
  const outroRaw =
    lastBullet >= 0 ? lines.slice(lastBullet + 1).join(' ') : '';

  const intro = collapseWs(introRaw)
    .replace(/:\s*$/, '')
    .replace(CHALLENGE_INTRO_SCAFFOLD, '')
    .trim();
  // Drop trailing scaffold sentence like "Several challenges emerged"
  const introClean = collapseWs(
    intro
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !CHALLENGE_INTRO_SCAFFOLD.test(s.replace(/:\s*$/, '')) && !isScaffold(s))
      .join(' ')
  );

  const outro = collapseWs(outroRaw);
  // Pull items from the bullet block only (avoid intro prose eating the extract cap)
  const bulletBlock =
    firstBullet >= 0
      ? lines.slice(firstBullet, lastBullet + 1).join('\n')
      : src;
  const shortItems = extractCleanBullets(bulletBlock, 6).filter(
    (b) => b.length >= 20 && b.length <= 100
  );

  const pieces: string[] = [];
  if (introClean) pieces.push(introClean);

  // Fold challenge items: clause-like → sentences; noun phrases → one "Gaps included" line
  const take = shortItems.slice(0, 3);
  const clauseLike = take.filter((t) =>
    /\b(required|needed|must|had to|integrate|persist|coordinate|support)\b/i.test(
      t
    )
  );

  if (clauseLike.length >= 2) {
    for (const item of clauseLike.slice(0, 2)) {
      const sentence = /[.!?]$/.test(item) ? item : `${item}.`;
      const next = [...pieces, sentence].join(' ');
      if (next.length > max) break;
      pieces.push(sentence);
    }
  } else if (take.length >= 2) {
    const parts = take.map((b, i) => {
      if (/^[A-Z]{2,}/.test(b)) return b;
      return b.charAt(0).toLowerCase() + b.slice(1);
    });
    const last = parts[parts.length - 1];
    const head = parts.slice(0, -1).join(', ');
    const sentence =
      parts.length === 1
        ? `Gaps included ${parts[0]}.`
        : `Gaps included ${head}, and ${last}.`;
    if ([...pieces, sentence].join(' ').length <= max) pieces.push(sentence);
  }

  if (outro && !isScaffold(outro)) {
    const next = [...pieces, outro].join(' ');
    if (next.length <= max) pieces.push(outro);
    else {
      while (pieces.length > 1) {
        pieces.pop();
        const attempt = [...pieces, outro].join(' ');
        if (attempt.length <= max) {
          pieces.push(outro);
          break;
        }
      }
    }
  }

  return trimToSentences(pieces.join(' '), max);
}

/**
 * Tech JSON shapes:
 * 1) string[]
 * 2) { title, items: string[] } groups → flatten items
 * 3) { title, description } where description holds • tech lines (category title)
 * 4) { title } where title IS the tech name (no items/description list)
 */
function techToItems(tech: unknown, max: number): string[] {
  if (!Array.isArray(tech)) return [];

  const out: string[] = [];
  const push = (name: string) => {
    const n = stripBulletPrefix(collapseWs(name));
    if (!n || n.length < 2) return;
    if (out.some((x) => x.toLowerCase() === n.toLowerCase())) return;
    out.push(n);
  };

  for (const t of tech) {
    if (out.length >= max) break;

    if (typeof t === 'string') {
      push(t);
      continue;
    }
    if (!t || typeof t !== 'object') continue;

    const row = t as {
      title?: unknown;
      name?: unknown;
      items?: unknown;
      description?: unknown;
    };

    if (Array.isArray(row.items) && row.items.length > 0) {
      for (const item of row.items) {
        if (out.length >= max) break;
        if (typeof item === 'string') push(item);
        else if (item && typeof item === 'object') {
          const it = item as { title?: unknown; name?: unknown };
          const n =
            (typeof it.title === 'string' && it.title) ||
            (typeof it.name === 'string' && it.name) ||
            '';
          if (n) push(n);
        }
      }
      continue;
    }

    if (typeof row.description === 'string' && /[•\n\-]/.test(row.description)) {
      const techs = extractCleanBullets(row.description, max - out.length);
      const fromDesc = row.description
        .split(/\r?\n|[•▪▸►]/)
        .map(stripBulletPrefix)
        .map(collapseWs)
        .filter((s) => s.length >= 2 && s.length < 80 && !isScaffold(s));
      for (const name of fromDesc.length ? fromDesc : techs) {
        if (out.length >= max) break;
        push(name);
      }
      continue;
    }

    const label =
      (typeof row.title === 'string' && row.title.trim()) ||
      (typeof row.name === 'string' && row.name.trim()) ||
      '';
    if (label) push(label);
  }

  return out.slice(0, max);
}

function mapUniqueLine(raw: string | null | undefined, max: number): string {
  if (isPlaceholder(raw)) return '';
  const src = raw!.trim();
  // Prefer first prose sentence before any bullet list / "Key differentiators"
  const beforeBullets = src.split(/\n\s*[•▪▸►]/)[0] || src;
  const prose = beforeBullets
    .split(/\n/)
    .map(collapseWs)
    .filter((s) => s && !INTRO_SCAFFOLD.test(s) && !/^key\s+differentiators?/i.test(s))
    .join(' ');
  const first = prose.split(/(?<=[.!?])\s+/)[0] || prose;
  return trimToSentences(first, max);
}

function contentDensity(
  challenge: string,
  solutionBullets: string[],
  outcomeBullets: string[],
  uniqueLine: string
): 'roomy' | 'balanced' | 'tight' {
  const bullets = solutionBullets.length + outcomeBullets.length;
  const bulletChars =
    solutionBullets.join('').length + outcomeBullets.join('').length;
  const weight = challenge.length + bulletChars + uniqueLine.length;
  const avg = bullets > 0 ? bulletChars / bullets : 0;

  // Only compress when overflow risk is real
  if (weight > 1350 || (bullets >= 10 && avg >= 75 && challenge.length > 420)) {
    return 'tight';
  }
  // Short phrase bullets + moderate weight → breathe into the page
  if (avg > 0 && avg < 65) return 'roomy';
  if (weight < 1100 || bullets <= 7) return 'roomy';
  return 'balanced';
}

export function mapCaseToOnepager(c: OnepagerCaseInput): OnepagerContent {
  // HOOK: client-name allowlist would replace c.clientName here when Marty rules exist
  const client = (c.clientName?.trim() || 'Confidential client').trim();

  const industry = (c.clientIndustry?.trim() || c.industry?.trim() || '—').trim();
  const market = (c.clientMarket?.trim() || '—').trim();

  const summary = c.summary?.trim()
    ? trimToSentences(c.summary, SUMMARY_CAP)
    : '';

  const challengeRaw = (c.challenge?.trim() || c.challenges?.trim() || '').trim();
  const challenge = challengeRaw ? mapChallenge(challengeRaw, CHALLENGE_CAP) : '';

  let solutionBullets = agentsToBullets(c.solutionAgents, MAX_BULLETS);
  if (solutionBullets.length === 0) {
    solutionBullets = extractCleanBullets(c.solution || '', MAX_BULLETS);
  }

  const outcomeSource = (c.benefits?.trim() || c.results?.trim() || '').trim();
  const outcomeBullets = extractCleanBullets(outcomeSource, MAX_BULLETS);

  // Optional fill: real uniqueSolution when the page would otherwise read sparse
  const columnsThin =
    solutionBullets.length < 4 ||
    outcomeBullets.length < 4 ||
    solutionBullets.length + outcomeBullets.length <= 6;
  const densityPreview = contentDensity(
    challenge,
    solutionBullets,
    outcomeBullets,
    ''
  );
  const uniqueLine =
    columnsThin || densityPreview !== 'tight'
      ? mapUniqueLine(c.uniqueSolution, UNIQUE_CAP)
      : '';

  const techItems = techToItems(c.tech, MAX_TECH);
  const density = contentDensity(
    challenge,
    solutionBullets,
    outcomeBullets,
    uniqueLine
  );

  return {
    title: c.title.trim(),
    client,
    industry,
    market,
    summary,
    challenge,
    solutionBullets,
    outcomeBullets,
    uniqueLine,
    techItems,
    density,
    slug: c.slug,
  };
}
