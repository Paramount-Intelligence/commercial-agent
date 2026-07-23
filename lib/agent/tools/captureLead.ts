/**
 * Anthropic tool: capture_lead — consent-based team follow-up handoff.
 *
 * Name/email/company default from the session AgentUser. The model should
 * CONFIRM those details and only ask for intent/topic (plus corrections).
 * Never fires without userConsented: true.
 *
 * Pipeline: validate → save Lead → best-effort PDF → email notify.
 * PDF failure must NOT block the email.
 */
import { prisma } from '../../db';
import { sendLeadNotification } from '../../email/mailer';
import { LEAD_CONFIG, leadNotifyRecipients } from '../../leads/config';
import { generateConversationPdf } from '../../leads/generateConversationPdf';
import type { DispatchContext } from './index';

export type CaptureLeadInput = {
  /** Must be true — user explicitly agreed to have the Paramount team follow up. */
  userConsented: boolean;
  /**
   * Optional overrides ONLY when the user corrected on-file details.
   * Prefer omitting these — the tool defaults from the session AgentUser.
   */
  name?: string;
  email?: string;
  company?: string;
  /** Short description of what they're working on / need. */
  topic: string;
  /** Optional longer notes. */
  notes?: string;
};

export type CaptureLeadToolResult = {
  modelResult: {
    ok: boolean;
    error?: string;
    leadId?: string;
    notified?: boolean;
    recipients?: string[];
    confirmation?: string;
    pdfUrl?: string;
    pdfGenerated?: boolean;
    /** Echo of what was stored (so Jackie can confirm back accurately). */
    saved?: {
      name: string;
      email: string;
      company: string | null;
      topic: string;
      usedSessionDefaults: {
        name: boolean;
        email: boolean;
        company: boolean;
      };
    };
  };
  retrievedIds: string[];
};

export const captureLeadToolDef = {
  name: 'capture_lead',
  description:
    'REQUIRED tool to actually notify Ali/Marty of a consenting lead. ' +
    'You MUST call this tool — NEVER claim you shared/sent/notified details unless ' +
    'this tool returned ok:true. Saying "I\'ve shared your details" without calling ' +
    'this tool is a hard failure. ' +
    'The logged-in user already has name, email, and affiliation on file — ' +
    'CONFIRM those naturally and ONLY ask for the intent/topic. ' +
    'Omit name/email/company unless the user corrected them; the tool defaults ' +
    'from the session AgentUser. Requires userConsented: true and topic. ' +
    'Call once the user has consented AND you have the topic.',
  input_schema: {
    type: 'object' as const,
    properties: {
      userConsented: {
        type: 'boolean',
        description:
          'True only if the user explicitly agreed to have the Paramount team follow up.',
      },
      name: {
        type: 'string',
        description:
          'Override ONLY if the user corrected their on-file name. Otherwise omit — session default is used.',
      },
      email: {
        type: 'string',
        description:
          'Override ONLY if the user corrected their on-file email. Otherwise omit — session default is used.',
      },
      company: {
        type: 'string',
        description:
          'Override ONLY if the user corrected their on-file company/affiliation. Otherwise omit.',
      },
      topic: {
        type: 'string',
        description:
          'Required. Short summary of what they need / are working on (the handoff topic).',
      },
      notes: {
        type: 'string',
        description: 'Optional extra context for the founders.',
      },
    },
    required: ['userConsented', 'topic'],
    additionalProperties: false,
  },
};

export async function runCaptureLead(
  input: CaptureLeadInput,
  ctx: DispatchContext,
): Promise<CaptureLeadToolResult> {
  console.info('[capture_lead] invoked', {
    conversationId: ctx.conversationId || null,
    agentUserId: ctx.agentUserId || null,
    userConsented: input.userConsented,
    topic: input.topic?.slice(0, 120) ?? null,
    hasNameOverride: Boolean(input.name?.trim()),
    hasEmailOverride: Boolean(input.email?.trim()),
    hasCompanyOverride: Boolean(input.company?.trim()),
  });

  if (!ctx.conversationId || !ctx.agentUserId) {
    console.error('[capture_lead] missing conversation context', {
      conversationId: ctx.conversationId,
      agentUserId: ctx.agentUserId,
    });
    return {
      modelResult: {
        ok: false,
        error: 'Missing conversation context — cannot capture lead.',
      },
      retrievedIds: [],
    };
  }

  if (input.userConsented !== true) {
    console.warn('[capture_lead] rejected — userConsented is not true');
    return {
      modelResult: {
        ok: false,
        error: LEAD_CONFIG.NEED_CONSENT,
      },
      retrievedIds: [],
    };
  }

  const topic = input.topic?.trim();
  if (!topic) {
    console.warn('[capture_lead] rejected — empty topic');
    return {
      modelResult: {
        ok: false,
        error:
          'topic is required — ask what they are working on before capturing. Do not re-ask for name/email if those are already on file in the session profile.',
      },
      retrievedIds: [],
    };
  }

  const agentUser = await prisma.agentUser.findUnique({
    where: { id: ctx.agentUserId },
    select: { id: true, name: true, email: true, affiliation: true },
  });
  if (!agentUser) {
    console.error('[capture_lead] session user not found', {
      agentUserId: ctx.agentUserId,
    });
    return {
      modelResult: { ok: false, error: 'Session user not found.' },
      retrievedIds: [],
    };
  }

  const nameOverride = input.name?.trim() || '';
  const emailOverride = input.email?.trim() || '';
  const companyOverride = input.company?.trim() || '';

  const name = (nameOverride || agentUser.name || '').trim();
  const email = (emailOverride || agentUser.email || '').trim();
  const company =
    (companyOverride || agentUser.affiliation || '').trim() || null;

  const usedSessionDefaults = {
    name: !nameOverride && Boolean(agentUser.name?.trim()),
    email: !emailOverride && Boolean(agentUser.email?.trim()),
    company: !companyOverride && Boolean(agentUser.affiliation?.trim()),
  };

  if (!name || !email) {
    console.warn('[capture_lead] missing name/email after session merge', {
      hasName: Boolean(name),
      hasEmail: Boolean(email),
    });
    return {
      modelResult: {
        ok: false,
        error:
          'Session is missing name or email. Ask ONLY for the missing field(s), not for details already on file.',
      },
      retrievedIds: [],
    };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: ctx.conversationId, userId: ctx.agentUserId },
    select: { id: true },
  });
  if (!conversation) {
    console.error('[capture_lead] conversation not found for user', {
      conversationId: ctx.conversationId,
      agentUserId: ctx.agentUserId,
    });
    return {
      modelResult: {
        ok: false,
        error: 'Conversation not found for this user.',
      },
      retrievedIds: [],
    };
  }

  const notes = input.notes?.trim() || null;
  const context = [topic, notes].filter(Boolean).join('\n\n');

  // 1) Persist lead first so a PDF/email failure still leaves a DB record.
  let lead: { id: string };
  try {
    lead = await prisma.lead.upsert({
      where: { conversationId: ctx.conversationId },
      create: {
        conversationId: ctx.conversationId,
        name,
        email,
        company,
        topic,
        context,
        pdfUrl: null,
      },
      update: {
        name,
        email,
        company,
        topic,
        context,
      },
      select: { id: true },
    });
    console.info('[capture_lead] Lead saved', {
      leadId: lead.id,
      conversationId: ctx.conversationId,
      name,
      email,
      company,
      topic: topic.slice(0, 80),
    });
  } catch (err) {
    console.error('[capture_lead] Lead DB save failed', err);
    return {
      modelResult: {
        ok: false,
        error: 'Could not save the lead record. Please try again in a moment.',
      },
      retrievedIds: [],
    };
  }

  // 2) Best-effort PDF — failure must not block email.
  let pdf: Awaited<ReturnType<typeof generateConversationPdf>> | null = null;
  try {
    console.info('[capture_lead] PDF generation starting', {
      conversationId: ctx.conversationId,
    });
    pdf = await generateConversationPdf({
      conversationId: ctx.conversationId,
      leadName: name,
      leadEmail: email,
      leadCompany: company,
      topic,
    });
    console.info('[capture_lead] PDF generated', {
      filename: pdf.filename,
      bytes: pdf.buffer.byteLength,
      url: pdf.url,
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { pdfUrl: pdf.url },
    });
  } catch (err) {
    console.error(
      '[capture_lead] PDF generation failed — continuing with email (no attachment)',
      err,
    );
    pdf = null;
  }

  // 3) Notify founders / LEAD_NOTIFY_TO.
  const recipients = leadNotifyRecipients();
  const envRaw = process.env.LEAD_NOTIFY_TO?.trim() || '';
  console.info('[capture_lead] notify recipients resolved', {
    leadId: lead.id,
    recipients,
    fromEnv: Boolean(envRaw),
    LEAD_NOTIFY_TO_preview: envRaw ? envRaw.slice(0, 80) : '(unset → defaults)',
    hasPdfAttachment: Boolean(pdf),
  });

  if (recipients.length === 0) {
    console.error('[capture_lead] no recipients — email skipped');
    return {
      modelResult: {
        ok: false,
        leadId: lead.id,
        notified: false,
        pdfUrl: pdf?.url,
        pdfGenerated: Boolean(pdf),
        saved: { name, email, company, topic, usedSessionDefaults },
        error:
          'Lead was saved, but no notify recipients are configured (LEAD_NOTIFY_TO empty).',
      },
      retrievedIds: [],
    };
  }

  let notified = false;
  try {
    console.info('[capture_lead] sending notify email…', {
      leadId: lead.id,
      to: recipients,
      attachPdf: Boolean(pdf),
    });
    await sendLeadNotification({
      name,
      email,
      company,
      topic,
      conversationId: ctx.conversationId,
      pdf: pdf
        ? { filename: pdf.filename, buffer: pdf.buffer, url: pdf.url }
        : null,
      recipients,
    });
    notified = true;
    await prisma.lead.update({
      where: { id: lead.id },
      data: { notifiedAt: new Date() },
    });
    console.info('[capture_lead] notify email sent OK', {
      leadId: lead.id,
      recipients,
      pdfAttached: Boolean(pdf),
    });
  } catch (err) {
    console.error('[capture_lead] notify email FAILED', {
      leadId: lead.id,
      recipients,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return {
      modelResult: {
        ok: false,
        leadId: lead.id,
        notified: false,
        pdfUrl: pdf?.url,
        pdfGenerated: Boolean(pdf),
        saved: { name, email, company, topic, usedSessionDefaults },
        error:
          'Lead was saved, but the notification email failed. Ask the user to retry in a moment, or have the team check the lead record.',
      },
      retrievedIds: [],
    };
  }

  return {
    modelResult: {
      ok: true,
      leadId: lead.id,
      notified,
      recipients,
      pdfUrl: pdf?.url,
      pdfGenerated: Boolean(pdf),
      confirmation: LEAD_CONFIG.CONFIRMATION,
      saved: { name, email, company, topic, usedSessionDefaults },
    },
    retrievedIds: [],
  };
}
