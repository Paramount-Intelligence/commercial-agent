/**
 * What an agent turn needs from approved knowledge (KNOWLEDGE_SOURCE=approved):
 * the evidence retrieved before the first model call, the core documents as
 * citable sources, and the lists for the buyer-output filter.
 */
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { RetrievedSrcChunk } from '../../agent/srcGrounding';
import type { ClientName } from '../../safety/buyerOutput';
import { unapprovedClientNames } from '../../safety/clientNames';
import { activeDocs, CORE_DOC_TYPES, docsById, knowledgeLists } from './catalog';
import { buildTurnEvidence, srcChunkFor, type TurnEvidence } from './context';
import { retrieveApproved } from './retrieve';

export type PreRetrieval = {
  evidence: TurnEvidence;
  embedMs: number;
  sqlMs: number;
  totalMs: number;
  cached: boolean;
  /** Set when retrieval failed; the turn continues without evidence. */
  error?: string;
};

export async function preRetrieve(userMessage: string): Promise<PreRetrieval> {
  const t0 = performance.now();
  try {
    const r = await retrieveApproved(userMessage);
    const docs = await docsById(r.chunks.map((c) => c.docId));
    return {
      evidence: buildTurnEvidence(r.chunks, docs),
      embedMs: r.embedMs,
      sqlMs: r.sqlMs,
      totalMs: Math.round(performance.now() - t0),
      cached: r.cached,
    };
  } catch (err) {
    return {
      evidence: { block: '', caseIds: [], cardIds: [], caseTitles: new Map(), src: [] },
      embedMs: 0,
      sqlMs: 0,
      totalMs: Math.round(performance.now() - t0),
      cached: false,
      error: err instanceof Error ? err.name : 'unknown',
    };
  }
}

/** Core documents are in the system prompt, so they are citable on every turn. */
export async function coreSrcChunks(): Promise<RetrievedSrcChunk[]> {
  return (await activeDocs()).filter((d) => CORE_DOC_TYPES.has(d.type)).map((d) => srcChunkFor(d, d.body));
}

/** Prompt caching: one breakpoint after the tool definitions. */
export function withToolCache(tools: Tool[]): Tool[] {
  if (tools.length === 0) return tools;
  return [...tools.slice(0, -1), { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } }];
}

export async function approvedFilterLists(): Promise<{ clientNames: ClientName[]; formerEmployers: string[] }> {
  const [lists, legacyNames] = await Promise.all([knowledgeLists(), unapprovedClientNames()]);
  return {
    clientNames: [...lists.confidentialNames.map((name) => ({ name })), ...legacyNames],
    formerEmployers: lists.formerEmployers,
  };
}
