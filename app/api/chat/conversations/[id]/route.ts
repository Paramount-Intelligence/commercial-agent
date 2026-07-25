/**
 * GET    /api/chat/conversations/[id] — load messages (owner, not deleted)
 * PATCH  /api/chat/conversations/[id] — rename
 * DELETE /api/chat/conversations/[id] — soft delete
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { caseDisplayMap, casesFromMap } from '@/lib/agent/citedCases';
import { extractAttachments } from '@/lib/agent/attachments';
import { findOwnedActiveConversation } from '@/lib/chat/ownedConversation';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await findOwnedActiveConversation(
      id,
      auth.agentUser.id,
    );
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const stored = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        citedCaseIds: true,
      },
    });

    const allCitedIds = stored.flatMap((m) => m.citedCaseIds);
    const displayMap = await caseDisplayMap(allCitedIds);

    const messages = stored.map((m) => {
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
      conversation: {
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt.toISOString(),
        createdAt: conversation.createdAt.toISOString(),
      },
      messages,
    });
  } catch (err) {
    console.error('[api/chat/conversations/[id] GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await findOwnedActiveConversation(
      id,
      auth.agentUser.id,
    );
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    let body: { title?: unknown };
    try {
      body = (await req.json()) as { title?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const title =
      typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (title.length > 120) {
      return NextResponse.json(
        { error: 'title must be 120 characters or fewer' },
        { status: 400 },
      );
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { title },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({
      conversation: {
        id: updated.id,
        title: updated.title,
        updatedAt: updated.updatedAt.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        messageCount: updated._count.messages,
      },
    });
  } catch (err) {
    console.error('[api/chat/conversations/[id] PATCH]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await findOwnedActiveConversation(
      id,
      auth.agentUser.id,
    );
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ ok: true, deletedId: conversation.id });
  } catch (err) {
    console.error('[api/chat/conversations/[id] DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
