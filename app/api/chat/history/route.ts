import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { caseDisplayMap, casesFromMap } from '@/lib/agent/citedCases';
import { extractAttachments } from '@/lib/agent/attachments';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Resume helper: the authenticated user's MOST RECENT non-deleted conversation
 * (by updatedAt), so returning users continue where they left off.
 * Ownership is structural — scoped to session userId.
 */
export async function GET() {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { userId: auth.agentUser.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            citedCaseIds: true,
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ conversationId: null, messages: [] });
    }

    const allCitedIds = conversation.messages.flatMap((m) => m.citedCaseIds);
    const displayMap = await caseDisplayMap(allCitedIds);

    const messages = conversation.messages.map((m) => {
      const { reply, attachments } =
        m.role === 'assistant'
          ? extractAttachments(m.content)
          : { reply: m.content, attachments: [] };
      return {
        id: m.id,
        role: m.role,
        content: reply,
        citedIds: m.citedCaseIds,
        citedCases:
          m.citedCaseIds.length > 0
            ? casesFromMap(displayMap, m.citedCaseIds)
            : [],
        attachments,
      };
    });

    return NextResponse.json({
      conversationId: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
      messages,
    });
  } catch (err) {
    console.error('[api/chat/history] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
