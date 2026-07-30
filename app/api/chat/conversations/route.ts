/**
 * GET  /api/chat/conversations — list non-deleted conversations that have at
 * least one message (empty drafts are client-only until first send)
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const rows = await prisma.conversation.findMany({
      where: {
        userId: auth.agentUser.id,
        deletedAt: null,
        messages: { some: {} },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({
      conversations: rows.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        messageCount: c._count.messages,
      })),
    });
  } catch (err) {
    console.error('[api/chat/conversations GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
