/** Shapes shared by ingest, the bundle, the import route and retrieval. */

export type Attribution =
  | 'paramount-positioning'
  | 'paramount-delivery-outcome'
  | 'ali-personal-contract'
  | 'ali-prior-employment';

export const ATTRIBUTIONS: readonly Attribution[] = [
  'paramount-positioning',
  'paramount-delivery-outcome',
  'ali-personal-contract',
  'ali-prior-employment',
];

export type DocMetadata = {
  subtitle?: string;
  industry?: string;
  businessFunction?: string;
  peBacked?: boolean | null;
  tech?: string[];
  /** founder-background and founder-led cases: the employer or platform. */
  employer?: string;
};

export type KnowledgeDocInput = {
  id: string;
  slug: string;
  type: string;
  title: string;
  attribution: Attribution;
  audience: string;
  status: string;
  clientName: string | null;
  clientNameApproved: boolean;
  sources: unknown[];
  metadata: DocMetadata;
  body: string;
  contentHash: string;
};

export type ChunkInput = {
  ordinal: number;
  header: string;
  content: string;
  tokenCount: number;
};

export type DocWithChunks = KnowledgeDocInput & { chunks: ChunkInput[] };

/** A doc ready to store: chunks carry embeddings (null only in dry runs). */
export type EmbeddedDoc = KnowledgeDocInput & { chunks: Array<ChunkInput & { embedding: number[] }> };
