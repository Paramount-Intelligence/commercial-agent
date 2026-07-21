import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const SITE_BASE = 'https://www.paramountintelligence.co';

/**
 * Full conversation transcript (read-only). Resolves citedCaseIds → titles.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { conversationId } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
            affiliation: true,
            organization: { select: { id: true, name: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            citedCaseIds: true,
            toolsUsed: true,
            tokensIn: true,
            tokensOut: true,
            rating: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const allCitedIds = [
      ...new Set(conversation.messages.flatMap((m) => m.citedCaseIds)),
    ];
    const cases =
      allCitedIds.length > 0
        ? await prisma.caseStudy.findMany({
            where: { id: { in: allCitedIds } },
            select: { id: true, title: true, slug: true },
          })
        : [];
    const caseById = new Map(cases.map((c) => [c.id, c]));

    const messages = conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      citedCases: m.citedCaseIds.map((id) => {
        const c = caseById.get(id);
        return {
          id,
          title: c?.title ?? id,
          url: c?.slug ? `${SITE_BASE}/case-studies/${c.slug}` : undefined,
        };
      }),
      toolsUsed: m.toolsUsed,
      tokensIn: m.tokensIn,
      tokensOut: m.tokensOut,
      rating: m.rating,
    }));

    const totalTokens = messages.reduce(
      (sum, m) => sum + m.tokensIn + m.tokensOut,
      0,
    );

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        createdAt: conversation.createdAt.toISOString(),
        messageCount: messages.length,
        totalTokens,
        user: {
          name: conversation.user.name,
          email: conversation.user.email,
          affiliation: conversation.user.affiliation,
        },
        organization: conversation.user.organization
          ? {
              id: conversation.user.organization.id,
              name: conversation.user.organization.name,
            }
          : null,
        messages,
      },
    });
  } catch (err) {
    console.error('[api/admin/transcripts/[id] GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
