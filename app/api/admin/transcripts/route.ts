import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const PREVIEW_CHARS = 100;
const FALLBACK_SNIPPET = "I don't have that detail on file";

/**
 * Paginated conversation list for the transcript viewer (read-only).
 * Query: page, pageSize, organizationId?, search?, failures? (1 = grounding handoffs)
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const url = new URL(req.url);
    const page = Math.max(0, Number(url.searchParams.get('page') ?? '0') || 0);
    const pageSizeRaw = Number(url.searchParams.get('pageSize') ?? '25') || 25;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const organizationId = url.searchParams.get('organizationId')?.trim() || null;
    const search = url.searchParams.get('search')?.trim() || null;
    const failuresOnly =
      url.searchParams.get('failures') === '1' ||
      url.searchParams.get('failures') === 'true';

    const where: Prisma.ConversationWhereInput = {};

    if (organizationId) {
      where.user = { organizationId };
    }

    const and: Prisma.ConversationWhereInput[] = [];

    if (search) {
      and.push({
        OR: [
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
          {
            messages: {
              some: { content: { contains: search, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    if (failuresOnly) {
      and.push({
        messages: {
          some: {
            role: 'assistant',
            content: { contains: FALLBACK_SNIPPET },
          },
        },
      });
    }

    if (and.length) where.AND = and;

    const [total, rows] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * pageSize,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          title: true,
          deletedAt: true,
          user: {
            select: {
              name: true,
              email: true,
              organization: { select: { id: true, name: true } },
            },
          },
          _count: { select: { messages: true } },
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              role: true,
              content: true,
              toolsUsed: true,
              ttsChars: true,
            },
          },
        },
      }),
    ]);

    const organizations = await prisma.organization.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    const conversations = rows.map((c) => {
      const firstUser = c.messages.find((m) => m.role === 'user');
      const first = firstUser?.content?.trim() ?? '';
      const preview =
        first.length > PREVIEW_CHARS
          ? first.slice(0, PREVIEW_CHARS).trimEnd() + '…'
          : first;

      const toolsUsed = [
        ...new Set(c.messages.flatMap((m) => m.toolsUsed ?? [])),
      ];
      const usedFallback = c.messages.some(
        (m) =>
          m.role === 'assistant' && m.content.includes(FALLBACK_SNIPPET),
      );
      const voiceLikely = c.messages.some((m) => (m.ttsChars ?? 0) > 0);

      return {
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        title: c.title,
        deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
        messageCount: c._count.messages,
        user: {
          name: c.user.name,
          email: c.user.email,
        },
        organization: c.user.organization
          ? { id: c.user.organization.id, name: c.user.organization.name }
          : null,
        preview,
        toolsUsed,
        usedFallback,
        voiceLikely,
      };
    });

    return NextResponse.json({
      conversations,
      total,
      page,
      pageSize,
      organizations,
      failuresOnly,
    });
  } catch (err) {
    console.error('[api/admin/transcripts GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
