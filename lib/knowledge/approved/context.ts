/**
 * Turn retrieved chunks into (1) the compact context block added to the user
 * turn and (2) the citation sets the validators check: case docs as
 * [[case:ID]], every other doc as [[src:ID]] (both by KnowledgeDoc id).
 */
import type { RetrievedSrcChunk } from '../../agent/srcGrounding';
import { anonymisedFromSubtitle, attributionWording, displayClient } from './attribution';
import type { ActiveDoc } from './catalog';
import type { ChunkHit } from './retrieve';

export function srcChunkFor(doc: Pick<ActiveDoc, 'id' | 'type' | 'title' | 'attribution' | 'metadata'>, content: string, sim = 1): RetrievedSrcChunk {
  return {
    id: doc.id,
    sim,
    attributionClass: doc.attribution,
    employer: doc.metadata.employer ?? null,
    startDate: null,
    endDate: null,
    sourceType: doc.type,
    heading: doc.title,
    content,
  };
}

export type TurnEvidence = {
  /** Appended to the user's message for this turn; empty when nothing matched. */
  block: string;
  caseIds: string[];
  caseTitles: Map<string, string>;
  src: RetrievedSrcChunk[];
};

export function buildTurnEvidence(chunks: ChunkHit[], docs: Map<string, ActiveDoc>): TurnEvidence {
  const caseIds: string[] = [];
  const caseTitles = new Map<string, string>();
  const src = new Map<string, RetrievedSrcChunk>();
  const byDoc = new Map<string, ChunkHit[]>();
  for (const c of chunks) byDoc.set(c.docId, [...(byDoc.get(c.docId) ?? []), c]);
  const parts: string[] = [];
  for (const [docId, hits] of byDoc) {
    const doc = docs.get(docId);
    if (!doc) continue;
    const isCase = doc.type === 'case';
    const tag = isCase ? `[[case:${docId}]]` : `[[src:${docId}]]`;
    const wording = attributionWording(doc.attribution);
    const lines = [`${tag} ${doc.title}`, `Attribution: ${doc.attribution} — ${wording.rule}`];
    if (isCase) {
      lines.push(`Client: ${displayClient({ ...doc, anonymised: anonymisedFromSubtitle(doc.metadata.subtitle) })}`);
      caseIds.push(docId);
      caseTitles.set(docId, doc.title);
    } else {
      src.set(docId, srcChunkFor(doc, hits.map((h) => h.content).join('\n…\n'), hits[0].sim));
    }
    lines.push(...hits.map((h) => `> ${h.content.replace(/\n+/g, ' ')}`));
    parts.push(lines.join('\n'));
  }
  const block = parts.length
    ? [
        '[RETRIEVED KNOWLEDGE for this question: the closest approved documents. They may not all be relevant; answer from them, cite what you use, and say plainly when none of them covers the question.]',
        ...parts,
      ].join('\n\n')
    : '[RETRIEVED KNOWLEDGE: nothing in the approved knowledge matches this question closely. Say so plainly; do not cite a case.]';
  return { block, caseIds, caseTitles, src: [...src.values()] };
}
