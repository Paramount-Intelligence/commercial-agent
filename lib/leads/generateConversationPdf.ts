/**
 * Build + store a branded conversation PDF for lead handoff.
 */
import { renderHtmlToPdf } from '../docgen/render';
import { buildConversationTranscriptHtml } from '../docgen/conversationTranscript';
import { loadConversationTranscriptData } from '../docgen/loadTranscriptData';
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
  const data = await loadConversationTranscriptData(opts.conversationId);
  const generatedAt = new Date();
  const html = buildConversationTranscriptHtml({
    audience: 'lead',
    leadName: opts.leadName,
    leadEmail: opts.leadEmail,
    leadCompany: opts.leadCompany,
    topic: opts.topic,
    conversationId: opts.conversationId,
    generatedAt,
    turns: data.turns,
    cases: data.cases,
    onepagers: data.onepagers,
  });

  const buffer = await renderHtmlToPdf(html);
  console.info('[lead-pdf] chromium render ok', {
    conversationId: opts.conversationId,
    bytes: buffer.byteLength,
  });
  const safeName =
    opts.leadName
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'lead';
  const filename = `lead-${safeName}-${opts.conversationId.slice(0, 8)}.pdf`;
  const { url } = await uploadAsset(buffer, filename, 'application/pdf');
  console.info('[lead-pdf] uploaded', { filename, url });

  return { buffer, url, filename };
}
