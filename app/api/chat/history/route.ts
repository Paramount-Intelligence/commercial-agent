import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { caseDisplayMap, casesFromMap } from '@/lib/agent/citedCases';
import { extractAttachments } from '@/lib/agent/attachments';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Single-thread resume: the authenticated user's MOST RECENT conversation with
 * all its messages, so the chat UI can continue it instead of starting blank.
 * Ownership is structural — the query is scoped to the session's userId, so
 * another user's conversation can never be returned.
 */
export async function GET() {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { userId: auth.agentUser.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
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

    // One lookup for every cited case across the whole history
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

    return NextResponse.json({ conversationId: conversation.id, messages });
  } catch (err) {
    console.error('[api/chat/history] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
