/**
 * Agent turn loop — buffer-and-gate.
 * Non-streaming Anthropic create(); validate citations before returning to the caller.
 * Never $disconnect() here (shared long-lived prisma).
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { prisma } from '../db';
import { assembleSystemPrompt } from './systemPrompt';
import { tools, dispatchTool } from './tools';
import type { OnepagerAttachment } from './tools';
import { embedAttachments, extractAttachments } from './attachments';
import {
  extractCitedIds,
  validateCitations,
  buildRegenerateFeedback,
} from './validator';
import {
  APPROVED_PRICING_FALLBACK,
  buildPricingRegenerateFeedback,
  isPricingDiscussion,
  validatePricingReply,
} from './pricing';
import {
  APPROVED_CONTACTS_FALLBACK_ALI_PHONE,
  APPROVED_CONTACTS_FALLBACK_SHARE,
  buildContactRegenerateFeedback,
  isContactDiscussion,
  isLeadCaptureIntent,
  validateContactReply,
} from './contacts';
import {
  isRetrievalTool,
  type AgentStageHandler,
} from './stages';

const MODEL = 'claude-sonnet-5';
const VOICE_MODEL = process.env.ANTHROPIC_VOICE_MODEL || 'claude-haiku-4-5';
const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 1500;
const OVERLOADED_REPLY =
  "Paramount's adviser is experiencing high demand right now — please try again in a moment.";
const DOCUMENT_READY_CLAIM_RE =
  /\b(?:one[\s-]?pager|document|pdf)\b[\s\S]{0,100}\b(?:ready|generated|download)|\b(?:ready|generated)\b[\s\S]{0,100}\b(?:one[\s-]?pager|document|pdf|download)\b/i;
const DOCUMENT_TOOL_FEEDBACK =
  'Your proposed reply claims a one-pager/document is ready, but no successful document tool result exists in this turn. Call generate_case_onepager (for a retrieved case) or share_document (for a shareable knowledge file) now. If the request is ambiguous, ask for clarification. If generation/share fails, say so plainly. Never claim a document is ready without a successful tool result in this same turn.';
const DOCUMENT_NOT_CREATED_REPLY =
  "I wasn't able to generate that one-pager just now, so I don't want to tell you it's ready when it isn't. Please try that request again.";
/** Model claimed a handoff without calling capture_lead — force a real tool call. */
const LEAD_SHARED_CLAIM_RE =
  /\b(?:i(?:'ve| have)? shared (?:your|the) details|shared your (?:details|info|information) with|i(?:'ve| have)? (?:notified|emailed|sent) (?:ali|marty|the (?:team|founders))|passed (?:your|the) details (?:to|along)|someone from the team will follow up)\b/i;
const LEAD_TOOL_FEEDBACK =
  'You claimed the team was notified / details were shared, but capture_lead was NOT called in this turn. Call capture_lead now with userConsented:true and the topic. Do not claim success until the tool returns ok:true. Do not re-ask for name/email/company when SESSION USER has them — confirm and pass topic only.';
const LEAD_NOT_CAPTURED_REPLY =
  "I can have the Paramount team follow up — once you confirm you'd like that and what you want them to know, I'll share your details right away.";

// SDK-level retries on top of our own withRetry below
const anthropic = new Anthropic({ maxRetries: 3 });

// --- Transient-error retry (mirrors lib/retrieval/embed.ts pattern) ---------

const RETRY_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 15_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

/**
 * Transient: 429 (rate limit), 529 (overloaded) and other 5xx, or a
 * network/timeout error (no HTTP status). 400/401/403/404 are real bugs — fail fast.
 */
function isTransientModelError(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined) return status === 429 || status >= 500;
  return err instanceof Anthropic.APIConnectionError;
}

/** Honor retry-after (seconds) when the API provides it; else use our backoff. */
function retryAfterMs(err: unknown, fallback: number): number {
  const h = (err as { headers?: unknown })?.headers;
  let raw: string | null | undefined;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    raw = h.get('retry-after');
  } else if (h && typeof h === 'object') {
    const rec = h as Record<string, string | undefined>;
    raw = rec['retry-after'] ?? rec['Retry-After'];
  }
  const sec = raw ? Number(raw) : NaN;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : fallback;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let delay = RETRY_BASE_DELAY_MS;
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientModelError(err) || i === RETRY_ATTEMPTS - 1) throw err;
      const wait = Math.min(retryAfterMs(err, delay), RETRY_MAX_DELAY_MS);
      console.warn(
        `[agent-loop] transient model error (status=${statusOf(err) ?? 'network'}), retry ${i + 1}/${RETRY_ATTEMPTS - 1} in ${wait}ms`,
      );
      await sleep(wait);
      delay = Math.min(delay * 2, RETRY_MAX_DELAY_MS);
    }
  }
  throw new Error('withRetry: retry exhausted');
}

function textFromContent(content: ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Inject known login-gate identity so Jackie confirms instead of re-collecting. */
function buildSessionProfileBlock(user: {
  name: string | null;
  email: string;
  affiliation: string | null;
}): string {
  const name = user.name?.trim() || '(not on file)';
  const email = user.email.trim();
  const company = user.affiliation?.trim() || '(not on file)';
  const nameOnFile = name !== '(not on file)';
  const companyOnFile = company !== '(not on file)';
  const confirmExample = nameOnFile
    ? `I've got you as ${name}${companyOnFile ? ` at ${company}` : ''}, reaching you at ${email} — is that right? What would you like the team to know?`
    : `I've got your email as ${email}${companyOnFile ? ` and company as ${company}` : ''} — is that the best reach? What would you like the team to know?`;

  return `===== SESSION USER (from login gate — already known) =====
Name: ${name}
Email: ${email}
Company / affiliation: ${company}

## HIGH PRIORITY — lead follow-up rules for THIS user (override softer habits)

- These details came from their authenticated session. Treat them as KNOWN FACTS.
- NEVER ask "could I grab your name, company, and email?" (or any re-collection of name/email/company) when the value above is on file — that is a hard failure.
- SHARING Ali/Marty emails ≠ capturing a lead. If they want the team to contact THEM / follow up / "email them that I want to be contacted", do NOT re-list Ali/Marty contacts. Move straight to confirmation + topic + \`capture_lead\`.
- When they want the team to follow up, CONFIRM naturally, e.g. "${confirmExample}"
- Only ask for: (1) intent/topic, and (2) corrections if they say a detail is wrong.
- When calling capture_lead, pass topic (+ name/email/company ONLY if they corrected them). Omit unchanged fields so the tool uses session defaults.
- NEVER say you shared/notified the team unless capture_lead returned ok:true in this turn — you must call the tool.`;
}

/** Fallback that confirms session identity instead of re-asking for it. */
function buildSessionConfirmFallback(user: {
  name: string | null;
  email: string;
  affiliation: string | null;
}): string {
  const name = user.name?.trim();
  const email = user.email.trim();
  const company = user.affiliation?.trim();
  if (name && email) {
    return `I've got you as ${name}${company ? ` at ${company}` : ''}, reaching you at ${email} — is that right? What would you like the Paramount team to know about what you're working on?`;
  }
  if (email) {
    return `I've got your email as ${email}${company ? ` and company as ${company}` : ''} on file — is that the best reach? What would you like the Paramount team to know about what you're working on?`;
  }
  return 'I can have the Paramount team follow up with you. What name, email, and company should they use, and what would you like them to know?';
}

function dedupeAttachments(
  attachments: OnepagerAttachment[],
): OnepagerAttachment[] {
  const byDocument = new Map<string, OnepagerAttachment>();
  for (const attachment of attachments) {
    const key =
      attachment.documentId ||
      (attachment.caseId
        ? `${attachment.caseId}:${attachment.format}`
        : attachment.url);
    byDocument.set(key, attachment);
  }
  return [...byDocument.values()];
}

/**
 * Run tool loop until end_turn text (or null if iteration cap).
 * Mutates messages / retrievedIds / toolsUsed / attachments; accumulates tokens.
 */
async function composeFinalText(ctx: {
  system: string;
  messages: MessageParam[];
  retrievedIds: Set<string>;
  toolsUsed: string[];
  attachments: OnepagerAttachment[];
  tokens: { in: number; out: number };
  model?: string;
  maxTokens?: number;
  onStage?: AgentStageHandler;
  conversationId: string;
  agentUserId: string;
}): Promise<string | null> {
  const {
    system,
    messages,
    retrievedIds,
    toolsUsed,
    attachments,
    tokens,
    model = MODEL,
    maxTokens = MAX_TOKENS,
    onStage,
    conversationId,
    agentUserId,
  } = ctx;
  let iterations = 0;
  let usedTools = false;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    // Honest stage: first model call = thinking; after tools = composing.
    onStage?.(usedTools ? 'composing' : 'thinking');
    const response = await withRetry(() =>
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
      }),
    );

    tokens.in += response.usage?.input_tokens ?? 0;
    tokens.out += response.usage?.output_tokens ?? 0;

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: ToolResultBlockParam[] = [];
      let retrieving = false;
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        toolsUsed.push(block.name);
        if (isRetrievalTool(block.name)) retrieving = true;
      }
      if (retrieving) onStage?.('searching');
      else onStage?.('composing');

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await dispatchTool(block.name, block.input, {
          retrievedIds,
          conversationId,
          agentUserId,
        });
        for (const id of result.retrievedIds) retrievedIds.add(id);
        if (
          'attachment' in result &&
          result.attachment &&
          typeof result.attachment === 'object'
        ) {
          attachments.push(result.attachment);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result.modelResult),
        });
      }

      messages.push({ role: 'user', content: toolResults });
      usedTools = true;
      continue;
    }

    onStage?.('composing');
    return textFromContent(response.content);
  }

  return null;
}

export async function runAgentTurn(input: {
  conversationId?: string;
  userMessage: string;
  /** REQUIRED: the authenticated AgentUser (from the session). No test-user fallback. */
  agentUserId: string;
  /** Low-latency delivery mode; guardrails and validation remain identical. */
  voiceMode?: boolean;
  /** Optional progress signals for voice UI (visual only). */
  onStage?: AgentStageHandler;
}): Promise<{
  conversationId: string;
  reply: string;
  citedIds: string[];
  attachments: OnepagerAttachment[];
  assistantMessageId: string | null;
  usedFallback: boolean;
  tokensIn: number;
  tokensOut: number;
}> {
  const agentUser = await prisma.agentUser.findUnique({
    where: { id: input.agentUserId },
    select: { name: true, email: true, affiliation: true },
  });
  if (!agentUser) {
    throw new Error(`AgentUser not found: ${input.agentUserId}`);
  }

  const sessionProfile = buildSessionProfileBlock(agentUser);
  console.info('[agent-loop] SESSION USER block', {
    agentUserId: input.agentUserId,
    name: agentUser.name,
    email: agentUser.email,
    affiliation: agentUser.affiliation,
    blockPreview: sessionProfile.slice(0, 280),
  });
  const system =
    (await assembleSystemPrompt({
      voiceMode: input.voiceMode,
    })) +
    '\n\n' +
    sessionProfile;
  const sessionConfirmFallback = buildSessionConfirmFallback(agentUser);
  const leadIntent = isLeadCaptureIntent(input.userMessage);
  const safeTurnFallback = isPricingDiscussion(input.userMessage)
    ? APPROVED_PRICING_FALLBACK
    : /\bali(?:'s|s)?\b[\s\S]{0,40}\b(?:phone|number|mobile|cell)\b/i.test(
          input.userMessage,
        )
      ? APPROVED_CONTACTS_FALLBACK_ALI_PHONE
      : leadIntent
        ? sessionConfirmFallback
        : isContactDiscussion(input.userMessage)
          ? APPROVED_CONTACTS_FALLBACK_SHARE
          : sessionConfirmFallback;
  const contactGateOptions = { allowEmails: [agentUser.email] };

  // 1. Load or create Conversation; persist user Message immediately
  let conversationId = input.conversationId;
  if (conversationId) {
    const existing = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    });
    // Ownership check: a user can only resume THEIR conversation. Same error
    // as not-found so IDs aren't probeable.
    if (!existing || existing.userId !== input.agentUserId) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
  } else {
    const created = await prisma.conversation.create({
      data: { userId: input.agentUserId },
    });
    conversationId = created.id;
  }

  await prisma.message.create({
    data: {
      conversationId,
      role: 'user',
      content: input.userMessage,
    },
  });

  // 2. Rebuild Anthropic messages + union retrievedIds from prior assistant turns
  const stored = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      content: true,
      retrievedCaseIds: true,
    },
  });

  const retrievedIds = new Set<string>();
  for (const m of stored) {
    if (m.role === 'assistant') {
      for (const id of m.retrievedCaseIds) retrievedIds.add(id);
    }
  }

  const messages: MessageParam[] = stored.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    // Strip embedded attachment markers so the model never sees them
    content:
      m.role === 'assistant'
        ? extractAttachments(m.content).reply
        : m.content,
  }));

  const toolsUsed: string[] = [];
  const attachments: OnepagerAttachment[] = [];
  const tokens = { in: 0, out: 0 };
  const composeCtx = {
    system,
    messages,
    retrievedIds,
    toolsUsed,
    attachments,
    tokens,
    model: input.voiceMode ? VOICE_MODEL : MODEL,
    maxTokens: input.voiceMode ? 700 : MAX_TOKENS,
    onStage: input.onStage,
    conversationId,
    agentUserId: input.agentUserId,
  };

  // 4–5. Compose (with tools) → validate → one regenerate compose if needed
  let reply: string;
  let usedFallback = false;

  let finalText: string | null;
  try {
    finalText = await composeFinalText(composeCtx);
  } catch (err) {
    if (isTransientModelError(err)) {
      // Retries exhausted on a capacity/network problem — degrade gracefully.
      // Deliberately NOT persisting an assistant Message: this is not a real
      // turn, and skipping it lets the user's retry start clean.
      console.error('[agent-loop] transient model failure after retries', {
        conversationId,
        status: statusOf(err),
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return {
        conversationId,
        reply: OVERLOADED_REPLY,
        citedIds: [],
        attachments: [],
        assistantMessageId: null,
        usedFallback: true,
        tokensIn: tokens.in,
        tokensOut: tokens.out,
      };
    }
    throw err; // genuine bug — let the route return a real 500
  }

  if (finalText === null) {
    console.error('[agent-loop] tool iteration cap exceeded', { conversationId });
    reply = safeTurnFallback;
    usedFallback = true;
  } else {
    // Delivery integrity gate: a model sentence can never manufacture a UI
    // download. Require a successful document tool result from THIS turn.
    if (
      attachments.length === 0 &&
      DOCUMENT_READY_CLAIM_RE.test(finalText)
    ) {
      messages.push({ role: 'user', content: DOCUMENT_TOOL_FEEDBACK });
      try {
        finalText = await composeFinalText(composeCtx);
      } catch (err) {
        if (!isTransientModelError(err)) throw err;
        finalText = DOCUMENT_NOT_CREATED_REPLY;
      }
      if (
        finalText &&
        attachments.length === 0 &&
        DOCUMENT_READY_CLAIM_RE.test(finalText)
      ) {
        finalText = DOCUMENT_NOT_CREATED_REPLY;
      }
    }

    // Lead integrity gate: never let Jackie claim a handoff without capture_lead.
    if (
      finalText &&
      LEAD_SHARED_CLAIM_RE.test(finalText) &&
      !toolsUsed.includes('capture_lead')
    ) {
      console.warn(
        '[agent-loop] lead claim without capture_lead — forcing tool call',
        { conversationId, preview: finalText.slice(0, 160) },
      );
      messages.push({ role: 'user', content: LEAD_TOOL_FEEDBACK });
      try {
        finalText = await composeFinalText(composeCtx);
      } catch (err) {
        if (!isTransientModelError(err)) throw err;
        finalText = LEAD_NOT_CAPTURED_REPLY;
      }
      if (
        finalText &&
        LEAD_SHARED_CLAIM_RE.test(finalText) &&
        !toolsUsed.includes('capture_lead')
      ) {
        console.error(
          '[agent-loop] lead claim still present after regenerate; capture_lead not called',
          { conversationId, toolsUsed },
        );
        finalText = LEAD_NOT_CAPTURED_REPLY;
      }
    }

    if (finalText === null) {
      reply = safeTurnFallback;
      usedFallback = true;
    } else {
    let citationValidation = validateCitations(finalText, retrievedIds);
    let pricingValidation = validatePricingReply(
      input.userMessage,
      finalText,
    );
    let contactValidation = validateContactReply(
      input.userMessage,
      finalText,
      contactGateOptions,
    );
    if (
      citationValidation.ok &&
      pricingValidation.ok &&
      contactValidation.ok
    ) {
      reply = finalText;
    } else {
      const feedback: string[] = [];
      if (!citationValidation.ok) {
        feedback.push(
          buildRegenerateFeedback(
            citationValidation.invalidIds,
            citationValidation.validIds,
          ),
        );
      }
      if (!pricingValidation.ok) {
        feedback.push(buildPricingRegenerateFeedback(pricingValidation.reasons));
      }
      if (!contactValidation.ok) {
        feedback.push(buildContactRegenerateFeedback(contactValidation.reasons));
      }
      messages.push({
        role: 'user',
        content: feedback.join('\n\n'),
      });

      // Same retrievedIds set — cases found on retry become valid to cite
      input.onStage?.('validating');
      let retryText: string | null;
      try {
        retryText = await composeFinalText(composeCtx);
      } catch (err) {
        if (isTransientModelError(err)) {
          console.error('[agent-loop] transient model failure during regenerate', {
            conversationId,
            status: statusOf(err),
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          return {
            conversationId,
            reply: OVERLOADED_REPLY,
            citedIds: [],
            attachments: [],
            assistantMessageId: null,
            usedFallback: true,
            tokensIn: tokens.in,
            tokensOut: tokens.out,
          };
        }
        throw err;
      }
      if (retryText === null) {
        console.error('[agent-loop] regenerate hit tool iteration cap', {
          conversationId,
        });
        reply = safeTurnFallback;
        usedFallback = true;
      } else {
        citationValidation = validateCitations(retryText, retrievedIds);
        pricingValidation = validatePricingReply(
          input.userMessage,
          retryText,
        );
        contactValidation = validateContactReply(
          input.userMessage,
          retryText,
          contactGateOptions,
        );
        if (
          citationValidation.ok &&
          pricingValidation.ok &&
          contactValidation.ok
        ) {
          reply = retryText;
        } else {
          console.error('[agent-loop] response validation failed twice', {
            conversationId,
            invalidIds: citationValidation.ok
              ? []
              : citationValidation.invalidIds,
            pricingReasons: pricingValidation.ok
              ? []
              : pricingValidation.reasons,
            contactReasons: contactValidation.ok
              ? []
              : contactValidation.reasons,
          });
          reply = safeTurnFallback;
          usedFallback = true;
        }
      }
    }
    }
  }

  // 6. Persist assistant Message (attachments embedded for history resume)
  const citedIds = usedFallback
    ? []
    : [...new Set(extractCitedIds(reply).filter((id) => retrievedIds.has(id)))];

  const turnAttachments = usedFallback ? [] : dedupeAttachments(attachments);
  const storedContent = embedAttachments(reply, turnAttachments);

  const createdMsg = await prisma.message.create({
    data: {
      conversationId,
      role: 'assistant',
      content: storedContent,
      citedCaseIds: citedIds,
      retrievedCaseIds: [...retrievedIds],
      toolsUsed: [...new Set(toolsUsed)],
      tokensIn: tokens.in,
      tokensOut: tokens.out,
    },
    select: { id: true },
  });

  if (usedFallback) {
    console.error('[agent-loop] usedFallback=true', { conversationId, citedIds: [] });
  }

  return {
    conversationId,
    reply,
    citedIds,
    attachments: turnAttachments,
    assistantMessageId: createdMsg.id,
    usedFallback,
    tokensIn: tokens.in,
    tokensOut: tokens.out,
  };
}
