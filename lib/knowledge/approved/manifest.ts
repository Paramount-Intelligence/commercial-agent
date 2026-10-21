/**
 * Turn Knowledge/manifest.yaml and its drafts into documents to load.
 * Skips status: hold, refuses drafts that fail the scan or disagree with the
 * manifest. File access is injected (scripts read the Knowledge folder).
 */
import { createHash } from 'crypto';
import { parse } from 'yaml';
import { ATTRIBUTIONS, type Attribution, type DocMetadata, type KnowledgeDocInput } from './types';
import { scanDoc, type ScanLists, type ScanProblem } from './scan';
import { formerEmployersFrom } from './employers';

/** Bump when chunking or headers change, so every doc is re-embedded once. */
export const CHUNKER_VERSION = 'c300-h1';

export type ManifestEntry = {
  id: string;
  path: string;
  type: string;
  attribution: string;
  audience?: string;
  status: string;
  sources?: unknown[];
  client_name?: string | null;
  client_name_approved?: boolean;
};

export type Manifest = { version: number; entries: ManifestEntry[] };

export function parseManifest(text: string): Manifest {
  const m = parse(text) as Manifest;
  if (!m || !Array.isArray(m.entries)) throw new Error('manifest.yaml has no entries');
  return m;
}

/** confidential-names.yaml: { names: [string | { name }] } */
export function parseConfidentialNames(text: string): string[] {
  const y = parse(text) as { names?: Array<string | { name?: string }> } | null;
  return (y?.names ?? [])
    .map((n) => (typeof n === 'string' ? n : (n?.name ?? '')).trim())
    .filter((n) => n.length >= 3);
}

/**
 * Drafts write some top-level values unquoted with ": " inside (e.g.
 * attribution_review), which strict YAML rejects; quote those before parsing.
 */
function quoteLooseScalars(fm: string): string {
  return fm
    .split('\n')
    .map((line) => {
      const m = line.match(/^([A-Za-z_][\w-]*):[ \t]+(.+)$/);
      if (!m || /^["'[{|>&*!]/.test(m[2]) || !/:\s/.test(m[2])) return line;
      return `${m[1]}: ${JSON.stringify(m[2].trim())}`;
    })
    .join('\n');
}

export function splitFrontMatter(text: string): { fm: Record<string, unknown>; body: string } {
  const t = text.replace(/\r\n/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error('missing front matter');
  return { fm: (parse(quoteLooseScalars(m[1])) as Record<string, unknown>) ?? {}, body: t.slice(m[0].length).trim() };
}

/** Source citations in drafts, e.g. "(Deck p11)" or "(Library L42, Client Benefits)": for reviewers, not buyers. */
const CITE_PARAGRAPH_RE = /^\((?:Deck|Library|library|KB|deck|code)\b[^\n]*\)\s*$/gm;
const CITE_INLINE_RE = /\s*\((?:Deck|Library|library|KB|CV|Resume|Product Resume)\b[^)]*\)/g;

export function stripSourceCites(text: string): string {
  return text.replace(CITE_PARAGRAPH_RE, '').replace(CITE_INLINE_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function hashDoc(d: Pick<KnowledgeDocInput, 'title' | 'type' | 'metadata' | 'body'>): string {
  return createHash('sha256')
    .update(JSON.stringify([CHUNKER_VERSION, d.title, d.type, d.metadata.industry ?? null, d.body]))
    .digest('hex');
}

export function docFromDraft(entry: ManifestEntry, fm: Record<string, unknown>, body: string): KnowledgeDocInput {
  if (!ATTRIBUTIONS.includes(entry.attribution as Attribution)) throw new Error(`unknown attribution "${entry.attribution}"`);
  if (str(fm.id) && fm.id !== entry.id) throw new Error('front matter id differs from the manifest');
  const title = str(fm.title);
  if (!title) throw new Error('missing title');
  const metadata: DocMetadata = {
    ...(str(fm.subtitle) ? { subtitle: str(fm.subtitle) } : {}),
    ...(str(fm.industry) ? { industry: str(fm.industry) } : {}),
    ...(str(fm.business_function) ? { businessFunction: str(fm.business_function) } : {}),
    ...(typeof fm.pe_backed === 'boolean' ? { peBacked: fm.pe_backed } : {}),
    ...(Array.isArray(fm.tech) ? { tech: fm.tech.map(String) } : {}),
    ...(str(fm.employer) ? { employer: str(fm.employer) } : {}),
  };
  const doc: Omit<KnowledgeDocInput, 'contentHash'> = {
    id: entry.id,
    slug: entry.id,
    type: entry.type,
    title,
    attribution: entry.attribution as Attribution,
    audience: entry.audience ?? 'buyer',
    status: entry.status,
    clientName: entry.client_name ?? null,
    clientNameApproved: entry.client_name_approved === true,
    sources: entry.sources ?? [],
    metadata,
    body: stripSourceCites(body),
  };
  return { ...doc, contentHash: hashDoc(doc) };
}

export type KnowledgePlan = {
  docs: KnowledgeDocInput[];
  held: string[];
  refused: Array<{ id: string; problems: ScanProblem[] | string }>;
  /** Stored with the knowledge for the buyer-output filter (never in the repo). */
  confidentialNames: string[];
  formerEmployers: string[];
};

export function planKnowledge(
  manifest: Manifest,
  readDraft: (path: string) => string,
  confidentialFromYaml: string[],
): KnowledgePlan {
  const held: string[] = [];
  const refused: KnowledgePlan['refused'] = [];
  const parsed: KnowledgeDocInput[] = [];
  for (const entry of manifest.entries) {
    if (entry.status === 'hold') {
      held.push(entry.id);
      continue;
    }
    try {
      const { fm, body } = splitFrontMatter(readDraft(entry.path));
      parsed.push(docFromDraft(entry, fm, body));
    } catch (err) {
      refused.push({ id: entry.id, problems: err instanceof Error ? err.message : String(err) });
    }
  }
  const formerEmployers = formerEmployersFrom(parsed.filter((d) => d.type === 'founder-background').map((d) => d.metadata.employer));
  const clientNames = manifest.entries.filter((e) => e.client_name && e.client_name_approved !== true).map((e) => String(e.client_name));
  const confidentialNames = [...new Set([...confidentialFromYaml, ...clientNames].map((n) => n.trim()).filter((n) => n.length >= 3))];
  const lists: ScanLists = { confidentialNames, formerEmployers };
  const docs: KnowledgeDocInput[] = [];
  for (const d of parsed) {
    const problems = scanDoc(d, lists);
    if (problems.length) refused.push({ id: d.id, problems });
    else docs.push(d);
  }
  return { docs, held, refused, confidentialNames, formerEmployers };
}
