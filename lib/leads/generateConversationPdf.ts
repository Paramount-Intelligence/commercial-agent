/**
 * Build + store a branded conversation PDF for lead handoff.
 */
import { prisma } from '../db';
import { extractAttachments } from '../agent/attachments';
import { buildCitedCases } from '../agent/citedCases';
import { renderHtmlToPdf } from '../docgen/render';
import {
  buildConversationTranscriptHtml,
  type ReferencedOnepager,
  type TranscriptTurn,
} from '../docgen/conversationTranscript';
import { uploadAsset } from '../storage/blob';

export type ConversationPdfResult = {
  buffer: Buffer;
  url: string;
  filename: string;
};

export async function generateConversationPdf(opts: {
  conversationId: string;
  leadName: string;
  leadEmail: string;
  leadCompany?: string | null;
  topic: string;
}): Promise<ConversationPdfResult> {
  const messages = await prisma.message.findMany({
    where: { conversationId: opts.conversationId },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      content: true,
      citedCaseIds: true,
      createdAt: true,
    },
  });

  const turns: TranscriptTurn[] = [];
  const citedIds: string[] = [];
  const onepagerMap = new Map<string, ReferencedOnepager>();

  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const { reply, attachments } =
      m.role === 'assistant'
        ? extractAttachments(m.content)
        : { reply: m.content, attachments: [] };
    const text = reply.trim();
    if (text) {
      turns.push({
        role: m.role as 'user' | 'assistant',
        text,
        createdAt: m.createdAt,
      });
    }
    if (m.role === 'assistant') {
      citedIds.push(...m.citedCaseIds);
      for (const a of attachments) {
        onepagerMap.set(a.url, {
          caseTitle: a.caseTitle,
          url: a.url,
          format: a.format,
        });
      }
    }
  }

  const cases = await buildCitedCases([...new Set(citedIds)]);
  const generatedAt = new Date();
  const html = buildConversationTranscriptHtml({
    leadName: opts.leadName,
    leadEmail: opts.leadEmail,
    leadCompany: opts.leadCompany,
    topic: opts.topic,
    conversationId: opts.conversationId,
    generatedAt,
    turns,
    cases: cases.map((c) => ({ title: c.title, url: c.url })),
    onepagers: [...onepagerMap.values()],
  });

  const buffer = await renderHtmlToPdf(html);
  console.info('[lead-pdf] chromium render ok', {
    conversationId: opts.conversationId,
    bytes: buffer.byteLength,
  });
  const safeName = opts.leadName
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'lead';
  const filename = `lead-${safeName}-${opts.conversationId.slice(0, 8)}.pdf`;
  const { url } = await uploadAsset(buffer, filename, 'application/pdf');
  console.info('[lead-pdf] uploaded', { filename, url });

  return { buffer, url, filename };
}
