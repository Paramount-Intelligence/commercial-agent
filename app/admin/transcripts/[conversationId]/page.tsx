import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { prisma } from '@/lib/db';
import TranscriptDetail from './TranscriptDetail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_BASE = 'https://www.paramountintelligence.co';

export default async function AdminTranscriptDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  await requireAdmin();
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

  if (!conversation) notFound();

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

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Paramount Intelligence · Backstage
            </p>
            <h1 className="m-0 mt-0.5 text-lg font-semibold text-slate-900">
              Conversation
            </h1>
          </div>
          <Link
            href="/admin/transcripts"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 no-underline"
          >
            ← Transcripts
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <TranscriptDetail
          conversation={{
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
          }}
        />
      </main>
    </div>
  );
}
