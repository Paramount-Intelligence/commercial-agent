import { stripEmDashes } from './agent/normalizeOutput';

const CASE_TAG_RE = /\[\[case:[^\]]+\]\]/gi;
const SRC_TAG_RE = /\[\[src:[^\]]+\]\]/gi;

export function stripCaseTags(text: string): string {
  return text
    .replace(CASE_TAG_RE, '')
    .replace(SRC_TAG_RE, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function normalizeMarkdownTables(text: string): string {
  return text.replace(/\|\s*\|/g, '|\n|');
}

export function formatVoiceDisplayText(text: string): string {
  return stripEmDashes(stripCaseTags(normalizeMarkdownTables(text))).trim();
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberForSpeech(raw: string): string {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0 || value >= 1000) return raw.replace(/,/g, '');
  if (!Number.isInteger(value)) {
    const [whole, decimal] = String(value).split('.');
    return `${numberForSpeech(whole)} point ${decimal.split('').map((d) => ONES[Number(d)]).join(' ')}`;
  }
  if (value < 20) return ONES[value]!;
  if (value < 100) {
    const rest = value % 10;
    return `${TENS[Math.floor(value / 10)]}${rest ? ` ${ONES[rest]}` : ''}`;
  }
  const rest = value % 100;
  return `${ONES[Math.floor(value / 100)]} hundred${rest ? ` ${numberForSpeech(String(rest))}` : ''}`;
}

export function expandCurrencyForSpeech(text: string): string {
  return text
    .replace(
      /\$\s*([\d,]+(?:\.\d+)?)\s*[–—−-]\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*|per\s+)?(hours?|hrs?)\b/gi,
      (_m, a: string, b: string) =>
        `${numberForSpeech(a)} to ${numberForSpeech(b)} dollars per hour`,
    )
    // Any other range: "$150-$250 for advisory" → "one hundred fifty to two hundred fifty dollars".
    .replace(
      /\$\s*([\d,]+(?:\.\d+)?)\s*[–—−-]\s*\$?\s*([\d,]+(?:\.\d+)?)/g,
      (_m, a: string, b: string) => `${numberForSpeech(a)} to ${numberForSpeech(b)} dollars`,
    )
    .replace(
      /\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*|per\s+)(hours?|hrs?)\b/gi,
      (_m, a: string) => `${numberForSpeech(a)} dollars per hour`,
    )
    .replace(
      /\$\s*([\d,]+(?:\.\d+)?)/g,
      (_m, a: string) => `${numberForSpeech(a)} dollars`,
    )
    .replace(/\b\/\s*hours?\b/gi, 'per hour')
    .replace(/\bper\s+hr\b/gi, 'per hour');
}

export function expandEmailForSpeech(text: string): string {
  return text.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (email) =>
    email
      .replace('@', ' at ')
      .replace(/\./g, ' dot ')
      .replace(/[-_+]/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

export function expandPercentagesForSpeech(text: string): string {
  return text
    .replace(/\b(\d+(?:\.\d+)?)\s*%?\s*[–—−-]\s*(\d+(?:\.\d+)?)\s*%/g, (_m, a: string, b: string) =>
      `${numberForSpeech(a)} to ${numberForSpeech(b)} percent`,
    )
    .replace(/\b(\d+(?:\.\d+)?)\s*%/g, (_m, value: string) => `${numberForSpeech(value)} percent`);
}

export function expandPhoneForSpeech(text: string): string {
  return text.replace(
    /\b(\d{3})[.\s-](\d{3})[.\s-](\d{4})\b/g,
    (_m, a: string, b: string, c: string) =>
      `${[...a].map((d) => ONES[Number(d)]).join(' ')}, ${[...b].map((d) => ONES[Number(d)]).join(' ')}, ${[...c].map((d) => ONES[Number(d)]).join(' ')}`,
  );
}

export function cleanVoiceText(text: string): string {
  const plain = stripCaseTags(flattenMarkdownTables(text))
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
    .replace(/\bready\s+for\s+download\s+(?:above|below)\b/gi, 'ready to download in the projects panel')
    .replace(/\bdownload\s+(it\s+)?(?:above|below)\b/gi, (_match, it: string | undefined) =>
      `download ${it ?? ''}in the projects panel`)
    .trim();
  return stripEmDashes(
    expandPhoneForSpeech(
      expandEmailForSpeech(expandPercentagesForSpeech(expandCurrencyForSpeech(plain))),
    ),
  );
}

function flattenMarkdownTables(text: string): string {
  const lines = normalizeMarkdownTables(text).split(/\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx < 0) {
      out.push(line);
      continue;
    }
    const prefix = trimmed.slice(0, pipeIdx).trim();
    let tablePart = trimmed.slice(pipeIdx).trim();
    if (!tablePart.startsWith('|')) tablePart = `|${tablePart}`;
    if (!tablePart.endsWith('|')) tablePart = `${tablePart}|`;
    if (prefix) out.push(prefix);
    if (/^\|[\s|:\-]+\|$/.test(tablePart)) continue;
    const cells = tablePart.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;
    if (cells.length >= 2 && /^category$/i.test(cells[0]!) && /range|rate|price/i.test(cells[1]!)) continue;
    out.push(cells.length === 1 ? `${cells[0]}.` : `${cells[0]}: ${cells.slice(1).join(', ')}.`);
  }
  return out.join('\n');
}
