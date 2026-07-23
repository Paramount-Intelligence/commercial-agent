/**
 * GET /api/chat/transcript?conversationId=...
 * Session-gated branded conversation PDF for the requesting user only.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import {
  getOrCreateUserTranscriptPdf,
  TranscriptEmptyError,
} from '@/lib/docgen/generateUserTranscriptPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

export async function GET(req: Request) {
  const auth = await readSession();
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const conversationId =
    new URL(req.url).searchParams.get('conversationId')?.trim() ?? '';
  if (!conversationId) {
    return NextResponse.json(
      { error: 'conversationId is required' },
      { status: 400 },
    );
  }

  // IDOR guard — must own the conversation.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: auth.agentUser.id },
    select: { id: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const pdf = await getOrCreateUserTranscriptPdf({
      conversationId,
      userName: auth.agentUser.name?.trim() || 'Guest',
      userEmail: auth.agentUser.email,
      userCompany: auth.agentUser.affiliation,
    });

    return new Response(new Uint8Array(pdf.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename(pdf.filename)}"`,
        'Cache-Control': 'private, no-store',
        'X-Transcript-Cache': pdf.cached ? 'hit' : 'miss',
      },
    });
  } catch (err) {
    if (err instanceof TranscriptEmptyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[api/chat/transcript]', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to generate conversation transcript',
      },
      { status: 500 },
    );
  }
}
