/**
 * Shared loader for conversation transcript PDF content (lead + user downloads).
 */
import { prisma } from '../db';
import { extractAttachments } from '../agent/attachments';
import { buildCitedCases } from '../agent/citedCases';
import type {
  ReferencedCase,
  ReferencedOnepager,
  TranscriptTurn,
} from './conversationTranscript';

export type ConversationTranscriptData = {
  turns: TranscriptTurn[];
  cases: ReferencedCase[];
  onepagers: ReferencedOnepager[];
  /** Max message createdAt included (cache watermark). Null if no turns. */
  throughAt: Date | null;
};

export async function loadConversationTranscriptData(
  conversationId: string,
): Promise<ConversationTranscriptData> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
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
  let throughAt: Date | null = null;

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
      if (!throughAt || m.createdAt > throughAt) throughAt = m.createdAt;
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
  return {
    turns,
    cases: cases.map((c) => ({ title: c.title, url: c.url })),
    onepagers: [...onepagerMap.values()],
    throughAt,
  };
}
