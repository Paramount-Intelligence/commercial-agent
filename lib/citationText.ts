import { stripEmDashes } from './agent/normalizeOutput';

const CASE_TAG_RE = /\[\[case:[^\]]+\]\]/gi;

/** Remove internal citation markers before displaying or speaking agent text. */
export function stripCaseTags(text: string): string {
  return text.replace(CASE_TAG_RE, '').replace(/[ \t]+\n/g, '\n').trim();
}

/** Normalize collapsed pipe-tables (`||`) into real row breaks for markdown render. */
export function normalizeMarkdownTables(text: string): string {
  return text.replace(/\|\s*\|/g, '|\n|');
}

/**
 * Caption / transcript display: keep markdown tables readable.
 * Citation tags stripped; do not flatten tables into prose.
 */
export function formatVoiceDisplayText(text: string): string {
  return stripEmDashes(stripCaseTags(normalizeMarkdownTables(text))).trim();
}

/**
 * "$90–$200 / hour" → "90 to 200 dollars per hour" for TTS.
 */
export function expandCurrencyForSpeech(text: string): string {
  const bare = (n: string) => n.replace(/,/g, '');
  return text
    .replace(
      /\$\s*([\d,]+(?:\.\d+)?)\s*[–—−-]\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*|per\s+)?(hours?|hrs?)\b/gi,
      (_m, a: string, b: string) =>
        `${bare(a)} to ${bare(b)} dollars per hour`,
    )
    .replace(
      /\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*|per\s+)(hours?|hrs?)\b/gi,
      (_m, a: string) => `${bare(a)} dollars per hour`,
    )
    .replace(
      /\$\s*([\d,]+(?:\.\d+)?)/g,
      (_m, a: string) => `${bare(a)} dollars`,
    )
    .replace(/\b\/\s*hours?\b/gi, 'per hour')
    .replace(/\bper\s+hr\b/gi, 'per hour');
}

/**
 * Convert validated agent output into natural plain text for speech (TTS).
 * Citation tags are removed only after validation has completed.
 * Em/en dashes are stripped last so the spoken path matches shipped chat text.
 */
export function cleanVoiceText(text: string): string {
  return stripEmDashes(
    expandCurrencyForSpeech(
      stripCaseTags(flattenMarkdownTables(text))
        .replace(/```(?:\w+)?\s*([\s\S]*?)```/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/([*_~])([^*_~]+)\1/g, '$2')
        .replace(/[*_~`]/g, '')
        .replace(/\|/g, ' ')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(
          /\bready\s+for\s+download\s+(?:above|below)\b/gi,
          'ready to download in the projects panel',
        )
        .replace(
          /\bdownload\s+(it\s+)?(?:above|below)\b/gi,
          (_match, it: string | undefined) =>
            `download ${it ?? ''}in the projects panel`,
        )
        .trim(),
    ),
  );
}

/**
 * Turn markdown pipe-tables into spoken "Category: range." lines.
 * Without this, voice captions collapse tables into a wall of `|` characters.
 * Also handles flattened single-line tables (`| a | b || --- || c | d |`).
 */
function flattenMarkdownTables(text: string): string {
  const normalized = normalizeMarkdownTables(text);
  const lines = normalized.split(/\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx < 0) {
      out.push(line);
      continue;
    }

    // Keep any prose before the first pipe on a mixed line.
    const prefix = trimmed.slice(0, pipeIdx).trim();
    let tablePart = trimmed.slice(pipeIdx).trim();
    if (!tablePart.startsWith('|')) tablePart = `|${tablePart}`;
    if (!tablePart.endsWith('|')) tablePart = `${tablePart}|`;

    if (prefix) out.push(prefix);

    // Alignment row: | --- | --- |
    if (/^\|[\s|:\-]+\|$/.test(tablePart)) continue;

    const cells = tablePart
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length === 0) continue;
    if (
      cells.length >= 2 &&
      /^category$/i.test(cells[0]!) &&
      /range|rate|price/i.test(cells[1]!)
    ) {
      continue;
    }
    if (cells.length === 1) {
      out.push(`${cells[0]}.`);
    } else {
      out.push(`${cells[0]}: ${cells.slice(1).join(', ')}.`);
    }
  }
  return out.join('\n');
}
