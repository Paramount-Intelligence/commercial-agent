/**
 * search_cases and search_company_info over approved knowledge
 * (KNOWLEDGE_SOURCE=approved), for follow-up searches. Same result shapes as
 * the legacy tools, so the loop and validators treat them alike.
 */
import type { ProjectedCase, SearchCasesToolResult } from '../../agent/tools/searchCases';
import type { SearchCompanyInfoToolResult } from '../../agent/tools/searchCompanyInfo';
import type { SearchCasesInput } from '../../retrieval/searchCases';
import { filterBuyerText } from '../../safety/buyerOutput';
import { anonymisedFromSubtitle, attributionWording, displayClient } from './attribution';
import { docsById } from './catalog';
import { srcChunkFor } from './context';
import { matchedTechs, retrieveApproved } from './retrieve';
import { approvedFilterLists } from './turn';

const SUMMARY_MAX = 300;

export async function approvedSearchCases(input: SearchCasesInput): Promise<SearchCasesToolResult> {
  const query = [input.query, ...(input.techs ?? [])].filter(Boolean).join(' ').trim();
  if (!query) return { modelResult: [], retrievedIds: [] };
  const r = await retrieveApproved(query, { types: ['case'] });
  const limit = Math.max(1, Math.min(input.limit ?? 5, 10));
  const ids = r.rankedDocIds.slice(0, limit);
  const [docs, lists] = await Promise.all([docsById(ids), approvedFilterLists()]);
  const modelResult: Array<ProjectedCase & { attribution: string; client: string }> = [];
  for (const id of ids) {
    const d = docs.get(id);
    if (!d) continue;
    if (input.peMatch === 'required' && d.metadata.peBacked !== true) continue;
    const hit = r.chunks.find((c) => c.docId === id);
    const mode = d.attribution === 'paramount-delivery-outcome' ? 'case' : 'reply';
    const summary = (d.metadata.subtitle ?? hit?.content ?? '').slice(0, SUMMARY_MAX);
    modelResult.push({
      id,
      citation: `[[case:${id}]]`,
      title: d.title,
      attribution: `${d.attribution} — ${attributionWording(d.attribution).rule}`,
      client: displayClient({ ...d, anonymised: anonymisedFromSubtitle(d.metadata.subtitle) }),
      matchedTechs: matchedTechs(query, d.metadata.tech),
      peBacked: d.metadata.peBacked ?? null,
      summary: filterBuyerText(summary, { mode, clientNames: lists.clientNames, formerEmployers: lists.formerEmployers }),
    });
  }
  return { modelResult, retrievedIds: modelResult.map((c) => c.id) };
}

export async function approvedSearchCompanyInfo(input: { query: string; limit?: number }): Promise<SearchCompanyInfoToolResult> {
  const query = input.query?.trim();
  if (!query) return { modelResult: [], sources: [], retrievedIds: [], retrievedSrc: [], query: '', topRelevanceScore: null };
  const r = await retrieveApproved(query, { excludeTypes: ['case'] });
  const limit = Math.max(1, Math.min(input.limit ?? 5, 10));
  const chunks = r.chunks.slice(0, limit);
  const docs = await docsById(chunks.map((c) => c.docId));
  const retrievedSrc: SearchCompanyInfoToolResult['retrievedSrc'] = [];
  const modelResult: SearchCompanyInfoToolResult['modelResult'] = [];
  for (const c of chunks) {
    const d = docs.get(c.docId);
    if (!d || modelResult.some((m) => m.id === d.id)) continue;
    const snippet = chunks.filter((x) => x.docId === d.id).map((x) => x.content).join('\n…\n');
    retrievedSrc.push(srcChunkFor(d, snippet, c.sim));
    modelResult.push({
      id: d.id,
      citation: `[[src:${d.id}]]`,
      title: d.title,
      sourceType: d.type,
      sourceUrl: `knowledge://${d.id}`,
      snippet: snippet.slice(0, 900),
      attributionClass: d.attribution,
      employer: d.metadata.employer ?? null,
    });
  }
  return {
    modelResult,
    sources: modelResult.map((m) => m.sourceUrl),
    retrievedIds: [],
    retrievedSrc,
    query,
    topRelevanceScore: chunks.length ? chunks[0].sim : null,
  };
}
