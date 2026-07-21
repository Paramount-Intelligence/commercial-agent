import { NextResponse } from 'next/server';
import { runAgentTurn } from '@/lib/agent/loop';
import { buildCitedCases } from '@/lib/agent/citedCases';
import { readSession } from '@/lib/auth/session';
import {
  checkAndReserveOrgQuota,
  checkDailyLlmTokenQuota,
  recordOrgTokens,
} from '@/lib/gating/orgLimit';

export const runtime = 'nodejs';
/** Chromium one-pager generation can take several seconds. */
export const maxDuration = 60;

const LIMIT_REACHED_REPLY =
  "That's a lot of ground covered today — we've reached the daily limit for your " +
  "organization's adviser access. Let's pick this back up tomorrow, or reach out to " +
  "the Paramount team directly if you'd like to keep going now.";

function errorPayload(err: unknown) {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error';
  const stack = err instanceof Error ? err.stack : undefined;
  return {
    error: message,
    ...(process.env.NODE_ENV !== 'production' && stack
      ? { stack: stack.split('\n').slice(0, 12) }
      : {}),
  };
}

export async function POST(req: Request) {
  try {
    // The airtight lock: even a direct API call needs a valid session cookie
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { conversationId?: string; message?: string; voiceMode?: boolean };
    try {
      body = (await req.json()) as {
        conversationId?: string;
        message?: string;
        voiceMode?: boolean;
      };
    } catch (parseErr) {
      console.error('[api/chat] body parse failed', parseErr);
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      );
    }

    // Token cost is known only after a turn. Block the next turn once today's
    // accumulated Claude usage has reached the org's configured ceiling.
    const tokenQuota = await checkDailyLlmTokenQuota(
      auth.organization.id,
      auth.organization.dailyLlmTokenLimit,
    );
    if (!tokenQuota.allowed) {
      return NextResponse.json({
        limitReached: true,
        limitType: 'llmTokens',
        used: tokenQuota.used,
        limit: tokenQuota.limit,
        reply: LIMIT_REACHED_REPLY,
      });
    }

    // Per-org daily cap — atomic reserve BEFORE any model call. Denied is a
    // 200 with a graceful reply (rendered as a normal assistant message), not
    // an error. The reservation counts the user's message regardless of model
    // outcome: it's a message-count cap, not a success cap.
    const quota = await checkAndReserveOrgQuota(
      auth.organization.id,
      auth.organization.dailyMsgLimit,
    );
    if (!quota.allowed) {
      return NextResponse.json({
        limitReached: true,
        reply: LIMIT_REACHED_REPLY,
      });
    }

    // Real authenticated user from the session — conversations key to them
    const result = await runAgentTurn({
      conversationId: body.conversationId,
      userMessage: message,
      agentUserId: auth.agentUser.id,
      voiceMode: body.voiceMode === true,
    });

    // Token accounting for the cost dashboard — best-effort, never fails the turn
    try {
      await recordOrgTokens(auth.organization.id, result.tokensIn + result.tokensOut);
    } catch (tokenErr) {
      console.error('[api/chat] token accounting failed', tokenErr);
    }

    const citedCases = await buildCitedCases(result.citedIds);

    if (result.attachments.length > 0) {
      console.info(
        '[api/chat] returning turn attachments',
        result.attachments.map((attachment) => ({
          documentId: attachment.documentId,
          caseId: attachment.caseId,
          caseTitle: attachment.caseTitle,
          format: attachment.format,
        })),
      );
    }

    return NextResponse.json({
      conversationId: result.conversationId,
      reply: result.reply,
      citedIds: result.citedIds,
      citedCases,
      attachments: result.attachments,
      assistantMessageId: result.assistantMessageId,
      usedFallback: result.usedFallback,
    });
  } catch (err) {
    console.error('[api/chat] unhandled', err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    return NextResponse.json(errorPayload(err), { status: 500 });
  }
}
