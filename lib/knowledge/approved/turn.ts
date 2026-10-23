/**
 * What an agent turn needs from approved knowledge (KNOWLEDGE_SOURCE=approved):
 * the evidence retrieved before the first model call, the core documents as
 * citable sources, and the lists for the buyer-output filter.
 */
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { createHash } from 'crypto';
import { restrictedEmployerInText, type RetrievedSrcChunk } from '../../agent/srcGrounding';
import type { ClientName } from '../../safety/buyerOutput';
import { unapprovedClientNames } from '../../safety/clientNames';
import { activeDocs, CORE_DOC_TYPES, docsById, knowledgeLists } from './catalog';
import { buildTurnEvidence, srcChunkFor, type TurnEvidence } from './context';
import { retrieveApproved } from './retrieve';
import { normaliseQuery } from '../../retrieval/queryEmbedding';
import { waitForRetrieval } from '../../retrieval/deadline';
import { TimedResultCache } from '../../retrieval/timedResultCache';

export const PRE_RETRIEVAL_CACHE_TTL_MS = 60_000;
export const PRE_RETRIEVAL_CACHE_MAX = 200;

export type PreRetrieval = {
  evidence: TurnEvidence;
  embedMs: number;
  sqlMs: number;
  totalMs: number;
  cached: boolean;
  cacheTier: 'result' | 'memory-or-upstream' | 'shared' | 'none';
  resultCacheHit: boolean;
  /** Set when retrieval failed; the turn continues without evidence. */
  error?: string;
};

const preRetrievalCache = new TimedResultCache<PreRetrieval>(
  PRE_RETRIEVAL_CACHE_MAX,
  PRE_RETRIEVAL_CACHE_TTL_MS,
);

function emptyEvidence(): TurnEvidence {
  return {
    block: '',
    caseIds: [],
    cardIds: [],
    caseTitles: new Map(),
    src: [],
  };
}

function preRetrievalKey(message: string): string {
  return createHash('sha256').update(normaliseQuery(message)).digest('hex');
}

function clonePreRetrieval(value: PreRetrieval): PreRetrieval {
  return {
    ...value,
    evidence: {
      ...value.evidence,
      caseIds: [...value.evidence.caseIds],
      cardIds: [...value.evidence.cardIds],
      caseTitles: new Map(value.evidence.caseTitles),
      src: [...value.evidence.src],
    },
  };
}

export async function preRetrieve(
  userMessage: string,
  opts: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<PreRetrieval> {
  const t0 = performance.now();
  const deadlineMs = opts.deadlineMs ?? 1_200;
  if (opts.signal?.aborted) {
    return {
      evidence: emptyEvidence(),
      embedMs: 0,
      sqlMs: 0,
      totalMs: 0,
      cached: false,
      cacheTier: 'none',
      resultCacheHit: false,
      error: 'AbortError',
    };
  }

  const key = preRetrievalKey(userMessage);
  const cacheHit = preRetrievalCache.get(key);
  if (cacheHit) {
    return {
      ...clonePreRetrieval(cacheHit),
      totalMs: Math.round(performance.now() - t0),
      cached: true,
      cacheTier: 'result',
      resultCacheHit: true,
    };
  }

  const deadline = new AbortController();
  const forwardAbort = () => deadline.abort();
  opts.signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const result = await waitForRetrieval(
      (async (): Promise<PreRetrieval> => {
        const [r, lists] = await Promise.all([
          retrieveApproved(userMessage, { signal: deadline.signal }),
          knowledgeLists(),
        ]);
        const docs = await docsById(r.chunks.map((c) => c.docId));
        // A question naming a former employer gets no case evidence: a reply
        // about that employer may not mention any case, so none is offered.
        const namesEmployer = Boolean(
          restrictedEmployerInText(userMessage, lists.formerEmployers),
        );
        const chunks = namesEmployer
          ? r.chunks.filter((c) => docs.get(c.docId)?.type !== 'case')
          : r.chunks;
        return {
          evidence: buildTurnEvidence(chunks, docs),
          embedMs: r.embedMs,
          sqlMs: r.sqlMs,
          totalMs: Math.round(performance.now() - t0),
          cached: r.cached,
          cacheTier: r.cacheTier,
          resultCacheHit: false,
        };
      })(),
      {
        deadlineMs,
        signal: opts.signal,
        onDeadline: () => deadline.abort(),
      },
    );
    preRetrievalCache.set(key, clonePreRetrieval(result));
    return result;
  } catch (err) {
    return {
      evidence: emptyEvidence(),
      embedMs: 0,
      sqlMs: 0,
      totalMs: Math.round(performance.now() - t0),
      cached: false,
      cacheTier: 'none',
      resultCacheHit: false,
      error: err instanceof Error ? err.name : 'unknown',
    };
  } finally {
    opts.signal?.removeEventListener('abort', forwardAbort);
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
