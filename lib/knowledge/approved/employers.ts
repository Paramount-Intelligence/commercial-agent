/**
 * Former employers and contracting platforms, derived from the knowledge (the
 * `employer` field of founder-background documents), not from a list in code.
 *
 * "Jazz (part of VEON), including JazzCash" → Jazz, VEON, JazzCash
 * "Daraz (Alibaba-backed e-commerce marketplace)" → Daraz, Alibaba
 *
 * Spelling variants are code: speech-to-text near-misses and former brand
 * names for an employer that the knowledge already lists.
 */

/** Capitalised names of 3+ letters (or "X and X" firm names) in an employer field. */
export function employerNames(field: string | undefined | null): string[] {
  if (!field) return [];
  const out: string[] = [];
  const re = /\b([A-Z][A-Za-z]{2,}(?:\s+and\s+[A-Z][A-Za-z]{2,})?)(?=[^A-Za-z]|$)/g;
  for (const m of field.matchAll(re)) {
    const name = m[1];
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Regex bodies for a name, including known variants. Lower-case keys. */
const VARIANTS: Record<string, string[]> = {
  bykea: ['b[iy]kea', 'baikeya', 'vaikea'],
  jazzcash: [String.raw`jazz[\s\-_.]*cash`],
  jazz: ['jazz', 'mobilink'],
  toptal: [String.raw`top[\s\-_.]*tal(?:\.com)?`],
  daraz: [String.raw`daraz(?:\.pk|\.com)?`],
};

export function nameBodies(name: string): string[] {
  const key = name.toLowerCase();
  if (VARIANTS[key]) return VARIANTS[key];
  return [
    name
      .trim()
      .split(/\s+/)
      .map((w) => (w.toLowerCase() === 'and' ? '(?:and|&)' : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()))
      .join(String.raw`\s*`),
  ];
}

/** Unique employer names from several employer fields, longest first (JazzCash before Jazz). */
export function formerEmployersFrom(fields: Array<string | undefined | null>): string[] {
  const all = new Set<string>();
  for (const f of fields) for (const n of employerNames(f)) all.add(n);
  return [...all].sort((a, b) => b.length - a.length || a.localeCompare(b));
}
