import { NextResponse } from 'next/server';
import { runAgentTurn } from '@/lib/agent/loop';
import { startPhaseTimer } from '@/lib/agent/phaseTimer';
import { buildCitedCases } from '@/lib/agent/citedCases';
import type { AgentStage } from '@/lib/agent/stages';
import { readSession } from '@/lib/auth/session';
import { recordOrgTokens, reserveTurnQuota } from '@/lib/gating/orgLimit';

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

type ChatBody = {
  conversationId?: string;
  message?: string;
  voiceMode?: boolean;
  /** When true (voice UI), stream NDJSON stage + result events. */
  streamStages?: boolean;
};

export async function POST(req: Request) {
  const timer = startPhaseTimer('api/chat');
  try {
    // The airtight lock: even a direct API call needs a valid session cookie
    const auth = await readSession();
    timer.mark('readSession');
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: ChatBody;
    try {
      body = (await req.json()) as ChatBody;
    } catch (parseErr) {
      console.error('[api/chat] body parse failed', parseErr);
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    timer.mark('bodyParse');

    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      );
    }

    const streamStages = body.streamStages === true;

    // Both daily caps in one atomic statement BEFORE any model call. Token
    // cost is only known after a turn, so the token ceiling gates the NEXT
    // turn. Denied is a 200 with a graceful reply (rendered as a normal
    // assistant message), not an error. A granted reservation counts the
    // user's message regardless of model outcome: it's a message-count cap,
    // not a success cap.
    const quota = await reserveTurnQuota(
      auth.organization.id,
      auth.organization.dailyMsgLimit,
      auth.organization.dailyLlmTokenLimit,
    );
    timer.mark('quota');
    if (!quota.allowed) {
      return NextResponse.json({
        limitReached: true,
        ...(quota.deniedBy === 'llmTokens'
          ? {
              limitType: 'llmTokens',
              used: quota.used,
              limit: quota.limit,
            }
          : {}),
        reply: LIMIT_REACHED_REPLY,
      });
    }

    if (!streamStages) {
      const result = await runAgentTurn({
        conversationId: body.conversationId,
        userMessage: message,
        agentUserId: auth.agentUser.id,
        agentUser: auth.agentUser,
        voiceMode: body.voiceMode === true,
        timer,
      });

      // Best-effort metering for the cost dashboard — never make the user wait
      // on it. It gates the next turn, not this one.
      void recordOrgTokens(
        auth.organization.id,
        result.tokensIn + result.tokensOut,
      ).catch((tokenErr) => {
        console.error('[api/chat] token accounting failed', tokenErr);
      });

      const citedCases = await buildCitedCases(result.citedIds);
      timer.mark('buildCitedCases');

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

      timer.log('request complete', {
        voiceMode: body.voiceMode === true,
        replyChars: result.reply.length,
      });

      return NextResponse.json({
        conversationId: result.conversationId,
        reply: result.reply,
        citedIds: result.citedIds,
        citedCases,
        attachments: result.attachments,
        assistantMessageId: result.assistantMessageId,
        usedFallback: result.usedFallback,
      });
    }

    // ── Voice progressive status: NDJSON stage events + final result ──
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (payload: unknown) => {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(payload)}\n`),
          );
        };
        try {
          write({ type: 'stage', stage: 'thinking' satisfies AgentStage });
          const result = await runAgentTurn({
            conversationId: body.conversationId,
            userMessage: message,
            agentUserId: auth.agentUser.id,
            agentUser: auth.agentUser,
            voiceMode: body.voiceMode === true,
            onStage: (stage) => write({ type: 'stage', stage }),
            timer,
          });

          void recordOrgTokens(
            auth.organization.id,
            result.tokensIn + result.tokensOut,
          ).catch((tokenErr) => {
            console.error('[api/chat] token accounting failed', tokenErr);
          });

          const citedCases = await buildCitedCases(result.citedIds);
          timer.mark('postTurn');
          timer.log('streamed request complete', {
            replyChars: result.reply.length,
          });
          write({
            type: 'result',
            conversationId: result.conversationId,
            reply: result.reply,
            citedIds: result.citedIds,
            citedCases,
            attachments: result.attachments,
            assistantMessageId: result.assistantMessageId,
            usedFallback: result.usedFallback,
          });
        } catch (err) {
          console.error('[api/chat] streamed turn failed', err);
          write({ type: 'error', ...errorPayload(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        // Discourage reverse-proxy buffering so stage events reach the voice UI live.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[api/chat] unhandled', err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    return NextResponse.json(errorPayload(err), { status: 500 });
  }
}
