import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const PREVIEW_CHARS = 100;

/**
 * Paginated conversation list for the transcript viewer (read-only).
 * Query: page (0-based), pageSize, organizationId?, search?
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

    const where: Prisma.ConversationWhereInput = {};

    if (organizationId) {
      where.user = { organizationId };
    }

    if (search) {
      where.OR = [
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        {
          messages: {
            some: { content: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

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
          user: {
            select: {
              name: true,
              email: true,
              organization: { select: { id: true, name: true } },
            },
          },
          _count: { select: { messages: true } },
          messages: {
            where: { role: 'user' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { content: true },
          },
        },
      }),
    ]);

    // Org filter dropdown options (all orgs that have at least one user)
    const organizations = await prisma.organization.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    const conversations = rows.map((c) => {
      const first = c.messages[0]?.content?.trim() ?? '';
      const preview =
        first.length > PREVIEW_CHARS
          ? first.slice(0, PREVIEW_CHARS).trimEnd() + '…'
          : first;
      return {
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        messageCount: c._count.messages,
        user: {
          name: c.user.name,
          email: c.user.email,
        },
        organization: c.user.organization
          ? { id: c.user.organization.id, name: c.user.organization.name }
          : null,
        preview,
      };
    });

    return NextResponse.json({
      conversations,
      total,
      page,
      pageSize,
      organizations,
    });
  } catch (err) {
    console.error('[api/admin/transcripts GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
