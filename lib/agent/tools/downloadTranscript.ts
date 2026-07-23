/**
 * Anthropic tool: download_transcript — offer a branded PDF of this conversation.
 * Attachment URL is the session-gated API so downloads stay IDOR-safe.
 */
import {
  getOrCreateUserTranscriptPdf,
  TranscriptEmptyError,
} from '../../docgen/generateUserTranscriptPdf';
import { prisma } from '../../db';
import type { OnepagerAttachment } from './generateCaseOnepager';
import type { DispatchContext } from './index';

export type DownloadTranscriptToolResult = {
  modelResult:
    | {
        ok: true;
        url: string;
        filename: string;
        cached: boolean;
        message: string;
      }
    | { ok: false; error: string };
  retrievedIds: string[];
  attachment?: OnepagerAttachment;
};

export const downloadTranscriptToolDef = {
  name: 'download_transcript',
  description:
    'Generate (or reuse a fresh cache of) a branded PDF transcript of THIS conversation ' +
    'for the logged-in user to download. Call when the user asks for a transcript, ' +
    'conversation PDF, record of this chat, or when offering a downloadable copy would help. ' +
    'Do not paste raw URLs — the UI shows a download card. Requires an existing conversation ' +
    'with at least one message.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
  },
};

export async function runDownloadTranscript(
  ctx: DispatchContext,
): Promise<DownloadTranscriptToolResult> {
  if (!ctx.conversationId || !ctx.agentUserId) {
    return {
      modelResult: {
        ok: false,
        error: 'Missing conversation or user context.',
      },
      retrievedIds: [],
    };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: ctx.conversationId, userId: ctx.agentUserId },
    select: {
      id: true,
      user: {
        select: { name: true, email: true, affiliation: true },
      },
    },
  });
  if (!conversation) {
    return {
      modelResult: {
        ok: false,
        error: 'Conversation not found for this user.',
      },
      retrievedIds: [],
    };
  }

  try {
    const pdf = await getOrCreateUserTranscriptPdf({
      conversationId: conversation.id,
      userName: conversation.user.name?.trim() || 'Guest',
      userEmail: conversation.user.email,
      userCompany: conversation.user.affiliation,
    });

    // Session-gated proxy — never hand out a bare public Blob URL for transcripts.
    const url = `/api/chat/transcript?conversationId=${encodeURIComponent(conversation.id)}`;
    const attachment: OnepagerAttachment = {
      documentId: `transcript:${conversation.id}`,
      url,
      filename: pdf.filename,
      caseTitle: 'Conversation transcript',
      source: 'transcript',
      format: 'pdf',
    };

    return {
      modelResult: {
        ok: true,
        url,
        filename: pdf.filename,
        cached: pdf.cached,
        message:
          'Transcript PDF is ready. A download card is shown in the UI — invite the user to download it.',
      },
      retrievedIds: [],
      attachment,
    };
  } catch (err) {
    if (err instanceof TranscriptEmptyError) {
      return {
        modelResult: { ok: false, error: err.message },
        retrievedIds: [],
      };
    }
    console.error('[download_transcript]', err);
    return {
      modelResult: {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to generate conversation transcript.',
      },
      retrievedIds: [],
    };
  }
}
