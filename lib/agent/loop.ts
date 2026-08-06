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
import { tools as ALL_TOOLS, dispatchTool } from './tools';
import type { LeadGeo } from '../leads/geo';
import type { OnepagerAttachment } from './tools';
import { embedAttachments, extractAttachments } from './attachments';
import {
  extractCitedIds,
  validateCitations,
  buildRegenerateFeedback,
} from './validator';
import {
  approvedPricingFallback,
  buildPricingRegenerateFeedback,
  explainPricingDiscussionTrigger,
  isPricingDiscussion,
  userAsksCommercialPricing,
  validatePricingReply,
} from './pricing';
import { resolveAgentUserName } from '../auth/agentUserName';
import {
  APPROVED_CONTACTS_FALLBACK_ALI_PHONE,
  APPROVED_CONTACTS_FALLBACK_SHARE,
  buildContactRegenerateFeedback,
  isCompanyInfoIntent,
  isContactDiscussion,
  isLeadCaptureIntent,
  validateContactReply,
} from './contacts';
import {
  isRetrievalTool,
  type AgentStageHandler,
} from './stages';
import { deriveConversationTitle } from '../chat/conversationTitle';
import { isConversationalNoToolsTurn } from './conversationalTurn';
import { startPhaseTimer, type PhaseTimer } from './phaseTimer';
import { notifyJackieFailure } from '../alerts/failureAlert';
import { stripEmDashes } from './normalizeOutput';
import {
  COMPANY_SRC_SAFE_FALLBACK,
  buildSrcRegenerateFeedback,
  repairMissingSrcCitations,
  shouldActivateSrcGate,
  stripSrcTokens,
  validateSrcGrounding,
  type RetrievedSrcChunk,
  type SrcValidationResult,
} from './srcGrounding';

const MODEL = 'claude-sonnet-5';
/** Faster model for voice + conversational/no-tool turns (greetings, thanks). */
const FAST_MODEL = process.env.ANTHROPIC_VOICE_MODEL || 'claude-haiku-4-5';
const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 1500;
const OVERLOADED_REPLY =
  "Paramount's adviser is experiencing high demand right now, please try again in a moment.";
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
  'You claimed the team was notified / details were shared, but capture_lead was NOT called in this turn. Call capture_lead now with userConsented:true and the topic. Do not claim success until the tool returns ok:true. Do not re-ask for name/email/company when SESSION USER has them, confirm and pass topic only.';
const LEAD_NOT_CAPTURED_REPLY =
  "I can have the Paramount team follow up, once you confirm you'd like that and what you want them to know, I'll share your details right away.";
const GENERAL_SAFE_FALLBACK =
  "I'm sorry, I wasn't able to answer that cleanly. Please ask me again and I'll give you a direct answer.";

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

/** A new question cancels any pending handoff inferred from the prior turn. */
function isQuestionLikeTurn(text: string): boolean {
  const t = text.trim();
  return (
    t.includes('?') ||
    /^(?:what|who|where|when|why|how|which|tell me|explain|describe|can you|could you|do you|does|is|are|i (?:want|would like) to (?:know|learn|hear|understand))\b/i.test(
      t,
    )
  );
}

/** Inject known login-gate identity so Jackie confirms instead of re-collecting. */
function buildSessionProfileBlock(user: {
  name: string | null;
  email: string;
  affiliation: string | null;
}): string {
  const email = user.email.trim();
  // Email-shaped "names" (autofill / mistaken entry) are not on file.
  const resolvedName = resolveAgentUserName(user.name, email);
  const name = resolvedName || '(not on file)';
  const company = user.affiliation?.trim() || '(not on file)';
  const nameOnFile = Boolean(resolvedName);
  const companyOnFile = company !== '(not on file)';
  const confirmExample = nameOnFile
    ? `I've got you as ${name}${companyOnFile ? ` at ${company}` : ''}, reaching you at ${email}, is that right? What would you like the team to know?`
    : `I've got your email as ${email}${companyOnFile ? ` and company as ${company}` : ''}, is that the best reach? What name should the team use, and what would you like them to know?`;

  return `===== SESSION USER (from login gate — already known) =====
Name: ${name}
Email: ${email}
Company / affiliation: ${company}

## HIGH PRIORITY — lead follow-up rules for THIS user (override softer habits)

- These details came from their authenticated session. Treat them as KNOWN FACTS.
- NEVER ask "could I grab your name, company, and email?" (or any re-collection of name/email/company) when the value above is on file — that is a hard failure.
- INFORMATION IS NOT A LEAD: "tell me about Paramount", "I want to know more about Paramount Intelligence", "what does Paramount do?", and similar requests mean the user wants an answer. Use company knowledge and answer conversationally. Do NOT confirm identity, ask what the team should know, or call \`capture_lead\`.
- Start lead follow-up ONLY when the user explicitly asks to connect, meet, talk with Ali/Marty/the team, or asks the team to contact/follow up with them. General interest, curiosity, or requests for information are never consent to a handoff.
- If the user asks an informational question after a follow-up was offered, drop the follow-up thread immediately and answer the new question. Never repeat the confirmation.
- SOURCE SEPARATION (HARD): A founder's former employment and a Paramount case study are independent evidence, even when both concern the same industry. State Ali's Bykea/ride-hailing employment as uncited founder background. State a retrieved Paramount ride-hailing case separately and cite only that case with the exact citation paired to its title. Never imply the case was Ali's Bykea work, never cite the Bykea biography with a case ID, and never use the biography to identify an anonymized case client.
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
  const email = user.email.trim();
  const name = resolveAgentUserName(user.name, email);
  const company = user.affiliation?.trim();
  if (name && email) {
    return `I've got you as ${name}${company ? ` at ${company}` : ''}, reaching you at ${email}, is that right? What would you like the Paramount team to know about what you're working on?`;
  }
  if (email) {
    return `I've got your email as ${email}${company ? ` and company as ${company}` : ''} on file, is that the best reach? What name should the team use, and what would you like the Paramount team to know about what you're working on?`;
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
  retrievedCaseTitles: Map<string, string>;
  /** Current-turn ContentChunk hits for [[src]] — NEVER merge into case IDs. */
  retrievedSrc: Map<string, RetrievedSrcChunk>;
  srcTelemetry: {
    lastQuery: string | null;
    hitCount: number;
    topRelevanceScore: number | null;
  };
  toolsUsed: string[];
  attachments: OnepagerAttachment[];
  tokens: { in: number; out: number };
  model?: string;
  maxTokens?: number;
  onStage?: AgentStageHandler;
  conversationId: string;
  agentUserId: string;
  /** Deterministic gate: capture_lead is unavailable without explicit intent. */
  leadCaptureAuthorized: boolean;
  /** Approximate location from the originating request (Vercel geo headers). */
  leadGeo?: LeadGeo | null;
  /** Empty = no tools offered (conversational / greeting turns). */
  toolsOffered?: typeof ALL_TOOLS;
  /** Diagnostic: accumulates raw Anthropic call ms across iterations. */
  modelMs?: { total: number; calls: number[] };
}): Promise<string | null> {
  const {
    system,
    messages,
    retrievedIds,
    retrievedCaseTitles,
    retrievedSrc,
    srcTelemetry,
    toolsUsed,
    attachments,
    tokens,
    model = MODEL,
    maxTokens = MAX_TOKENS,
    onStage,
    conversationId,
    agentUserId,
    leadCaptureAuthorized,
    leadGeo = null,
    toolsOffered = ALL_TOOLS,
    modelMs,
  } = ctx;
  let iterations = 0;
  let usedTools = false;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    // Honest stage: first model call = thinking; after tools = composing.
    onStage?.(usedTools ? 'composing' : 'thinking');
    const callStartedAt = performance.now();
    const response = await withRetry(() =>
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(toolsOffered.length > 0 ? { tools: toolsOffered } : {}),
      }),
    );
    if (modelMs) {
      const callMs = Math.round(performance.now() - callStartedAt);
      modelMs.total += callMs;
      modelMs.calls.push(callMs);
    }

    tokens.in += response.usage?.input_tokens ?? 0;
    tokens.out += response.usage?.output_tokens ?? 0;

    if (response.stop_reason === 'tool_use') {
      if (toolsOffered.length === 0) {
        // Should be unreachable — no tools were offered.
        console.warn('[agent-loop] tool_use with empty toolsOffered', {
          conversationId,
        });
        return textFromContent(response.content);
      }
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
          leadCaptureAuthorized,
          leadGeo,
        });
        if (block.name === 'search_cases' && Array.isArray(result.modelResult)) {
          for (const item of result.modelResult) {
            if (
              item &&
              typeof item === 'object' &&
              'id' in item &&
              'title' in item &&
              typeof item.id === 'string' &&
              typeof item.title === 'string'
            ) {
              retrievedCaseTitles.set(item.id, item.title);
            }
          }
        }
        if (
          block.name === 'search_company_info' &&
          'retrievedSrc' in result &&
          Array.isArray(result.retrievedSrc)
        ) {
          for (const chunk of result.retrievedSrc as RetrievedSrcChunk[]) {
            retrievedSrc.set(chunk.id, chunk);
          }
          srcTelemetry.hitCount = retrievedSrc.size;
          const scores = [...retrievedSrc.values()].map((c) => c.sim);
          srcTelemetry.topRelevanceScore =
            scores.length > 0 ? Math.max(...scores) : null;
          if ('query' in result && typeof result.query === 'string') {
            srcTelemetry.lastQuery = result.query;
          }
        }
        // Case namespace only — company tool always returns retrievedIds: [].
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
  /** The already-loaded user row, to avoid re-reading what the session read. */
  agentUser?: { name: string | null; email: string; affiliation: string | null };
  /** Org from the session — used only for failure alerts. */
  organization?: { id: string; name: string } | null;
  /** Low-latency delivery mode; guardrails and validation remain identical. */
  voiceMode?: boolean;
  /** Optional progress signals for voice UI (visual only). */
  onStage?: AgentStageHandler;
  /** Diagnostic: continue the caller's phase timer instead of starting one. */
  timer?: PhaseTimer;
  /**
   * Approximate location from the HTTP request that started this turn
   * (Vercel geo headers). Persisted on Lead at capture time.
   */
  leadGeo?: LeadGeo | null;
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
  const timer = input.timer ?? startPhaseTimer('agent-loop');
  // The caller (route) already loaded this user for the session check; re-use
  // it rather than paying another round-trip for the same row.
  const agentUser =
    input.agentUser ??
    (await prisma.agentUser.findUnique({
      where: { id: input.agentUserId },
      select: { name: true, email: true, affiliation: true },
    }));
  if (!agentUser) {
    throw new Error(`AgentUser not found: ${input.agentUserId}`);
  }
  timer.mark('agentUserLoad');

  const sessionProfile = buildSessionProfileBlock(agentUser);
  const conversationalNoTools = isConversationalNoToolsTurn(input.userMessage);
  // Haiku for greetings/small-talk (speed); Sonnet for substantive chat; voice
  // already uses the fast model for every turn.
  const model = input.voiceMode || conversationalNoTools ? FAST_MODEL : MODEL;
  const maxTokens =
    input.voiceMode || conversationalNoTools ? 1_200 : MAX_TOKENS;
  const turnStartedAt = Date.now();
  console.info('[agent-loop] turn start', {
    agentUserId: input.agentUserId,
    voiceMode: Boolean(input.voiceMode),
    conversationalNoTools,
    model,
    userPreview: input.userMessage.slice(0, 100),
  });
  const sessionDisplayName = resolveAgentUserName(
    agentUser.name,
    agentUser.email,
  );
  console.info('[agent-loop] SESSION USER block', {
    agentUserId: input.agentUserId,
    name: sessionDisplayName,
    rawName: agentUser.name,
    emailShapedNameIgnored: Boolean(
      agentUser.name?.trim() && !sessionDisplayName,
    ),
    email: agentUser.email,
    affiliation: agentUser.affiliation,
    blockPreview: sessionProfile.slice(0, 280),
  });
  const system =
    (await assembleSystemPrompt({
      voiceMode: input.voiceMode,
      omitCaseIndex: conversationalNoTools,
    })) +
    '\n\n' +
    sessionProfile;
  timer.mark('promptAssembly');
  const sessionConfirmFallback = buildSessionConfirmFallback(agentUser);
  const leadIntent = isLeadCaptureIntent(input.userMessage);
  const companyInfoIntent = isCompanyInfoIntent(input.userMessage);
  const pricingAsk = userAsksCommercialPricing(input.userMessage);
  let safeTurnFallback = pricingAsk
    ? approvedPricingFallback(Boolean(input.voiceMode))
    : /\bali(?:'s|s)?\b[\s\S]{0,40}\b(?:phone|number|mobile|cell)\b/i.test(
          input.userMessage,
        )
      ? APPROVED_CONTACTS_FALLBACK_ALI_PHONE
      : leadIntent
        ? sessionConfirmFallback
        : isContactDiscussion(input.userMessage)
          ? APPROVED_CONTACTS_FALLBACK_SHARE
          : GENERAL_SAFE_FALLBACK;
  const contactGateOptions = { allowEmails: [agentUser.email] };

  // 1. Load or create Conversation; persist user Message immediately
  let conversationId = input.conversationId;
  let existingTitle: string | null = null;
  if (conversationId) {
    const existing = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true, deletedAt: true, title: true },
    });
    // Ownership + soft-delete: same error as not-found so IDs aren't probeable.
    if (
      !existing ||
      existing.userId !== input.agentUserId ||
      existing.deletedAt
    ) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    existingTitle = existing.title;
  } else {
    const created = await prisma.conversation.create({
      data: { userId: input.agentUserId },
    });
    conversationId = created.id;
  }

  // 2. Persist the user message and read the prior history together — the
  // read excludes the message being written, which we append below, so the
  // result is identical to doing them in series. The prior rows also give the
  // user-message count, replacing a separate COUNT query.
  const [createdUserMsg, read] = await Promise.all([
    prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: input.userMessage,
      },
      select: { id: true },
    }),
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        retrievedCaseIds: true,
      },
    }),
  ]);
  // The two run concurrently, so the read may or may not have seen the write.
  // Drop it either way and append it once, in its correct trailing position.
  const prior = read.filter((m) => m.id !== createdUserMsg.id);
  const stored = [
    ...prior,
    { role: 'user', content: input.userMessage, retrievedCaseIds: [] },
  ];

  // Auto-title on first user message; always bump updatedAt for sidebar sort.
  // Nothing in this turn reads the result, so it must not block the reply.
  const titleUpdate =
    prior.every((m) => m.role !== 'user') && !existingTitle
      ? deriveConversationTitle(input.userMessage)
      : undefined;
  // @updatedAt bumps on any update, including one that only sets the title,
  // so the sidebar sort order stays correct without setting it by hand.
  void prisma.conversation
    .update({
      where: { id: conversationId },
      data: titleUpdate ? { title: titleUpdate } : {},
    })
    .catch((err) => {
      console.error('[agent-loop] conversation title/updatedAt bump failed', {
        conversationId,
        err,
      });
    });

  const retrievedIds = new Set<string>();
  const retrievedCaseTitles = new Map<string, string>();
  // Current-turn ONLY — never seeded from prior messages (corpus boundary).
  const retrievedSrc = new Map<string, RetrievedSrcChunk>();
  const srcTelemetry = {
    lastQuery: null as string | null,
    hitCount: 0,
    topRelevanceScore: null as number | null,
  };
  for (const m of stored) {
    if (m.role === 'assistant') {
      for (const id of m.retrievedCaseIds) retrievedIds.add(id);
    }
  }

  timer.mark('conversationIo');

  const messages: MessageParam[] = stored.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    // Strip embedded attachment markers so the model never sees them
    content:
      m.role === 'assistant'
        ? extractAttachments(m.content).reply
        : m.content,
  }));
  const priorUserTexts = prior
    .filter((m) => m.role === 'user')
    .map((m) => m.content);
  const leadCaptureAuthorized =
    leadIntent ||
    (!companyInfoIntent &&
      !isQuestionLikeTurn(input.userMessage) &&
      priorUserTexts.slice(-1).some((text) => isLeadCaptureIntent(text)));

  const toolsUsed: string[] = [];
  const attachments: OnepagerAttachment[] = [];
  const tokens = { in: 0, out: 0 };
  const toolsOffered = conversationalNoTools ? [] : ALL_TOOLS;
  if (conversationalNoTools) {
    console.info('[agent-loop] tools withheld for conversational turn', {
      conversationId,
      userPreview: input.userMessage.slice(0, 100),
    });
  }
  const modelMs = { total: 0, calls: [] as number[] };
  const composeCtx = {
    system,
    messages,
    retrievedIds,
    retrievedCaseTitles,
    retrievedSrc,
    srcTelemetry,
    toolsUsed,
    attachments,
    tokens,
    model,
    maxTokens,
    onStage: input.onStage,
    conversationId,
    agentUserId: input.agentUserId,
    leadCaptureAuthorized,
    leadGeo: input.leadGeo ?? null,
    toolsOffered,
    modelMs,
  };

  // 4–5. Compose (with tools) → validate → one regenerate compose if needed
  let reply: string;
  let usedFallback = false;
  let fallbackReason: string | null = null;
  let failureAlerted = false;
  const alertOrg = input.organization
    ? { orgId: input.organization.id, orgName: input.organization.name }
    : {};

  let finalText: string | null;
  try {
    finalText = await composeFinalText(composeCtx);
  } catch (err) {
    if (isTransientModelError(err)) {
      // Retries exhausted on a capacity/network problem — degrade gracefully.
      // Deliberately NOT persisting an assistant Message: this is not a real
      // turn, and skipping it lets the user's retry start clean.
      const reason = err instanceof Error ? err.message : String(err);
      console.error('[agent-loop] transient model failure after retries', {
        conversationId,
        status: statusOf(err),
        error: reason,
        stack: err instanceof Error ? err.stack : undefined,
      });
      notifyJackieFailure({
        kind: 'model_overloaded',
        reason: `Transient model failure after retries (HTTP ${statusOf(err) ?? 'n/a'}): ${reason}`.slice(
          0,
          280,
        ),
        conversationId,
        route: 'agent-loop',
        ...alertOrg,
      });
      return {
        conversationId,
        reply: stripEmDashes(OVERLOADED_REPLY),
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
  timer.mark('compose');

  if (finalText === null) {
    console.error('[agent-loop] tool iteration cap exceeded', { conversationId });
    reply = safeTurnFallback;
    usedFallback = true;
    fallbackReason = 'tool iteration cap exceeded';
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
      fallbackReason = 'tool iteration cap exceeded after integrity regenerate';
    } else {
    const runSrcValidation = (text: string): SrcValidationResult => {
      const citedCaseIds = new Set(
        extractCitedIds(text).filter((id) => retrievedIds.has(id)),
      );
      return validateSrcGrounding({
        replyText: text,
        retrievedSrc,
        caseRetrievedIds: retrievedIds,
        validCaseIdsInReply: citedCaseIds,
        retrievedCaseTitles,
        gateActive: shouldActivateSrcGate({
          userMessage: input.userMessage,
          replyText: text,
          usedSearchCompanyInfo: toolsUsed.includes('search_company_info'),
        }),
      });
    };

    const alertSrcFailure = (
      failure: Extract<SrcValidationResult, { ok: false }>,
      kind: 'src_grounding_rejected' | 'src_grounding_fallback' | 'attribution_rejected',
    ) => {
      const attributionRules = new Set([
        'non_assertable_src',
        'ali_misattributed_as_firm',
        'delivery_outcome_without_case',
        'ali_metric_without_case',
        'deanon_employer_case_bridge',
        'suppressed_uncleared_client_metric',
      ]);
      const resolvedKind =
        kind === 'src_grounding_fallback'
          ? kind
          : attributionRules.has(failure.rule)
            ? 'attribution_rejected'
            : 'src_grounding_rejected';
      notifyJackieFailure({
        kind: resolvedKind,
        reason: `${failure.rule}: ${failure.offendingAssertion}`.slice(0, 280),
        conversationId,
        route: 'agent-loop',
        ...alertOrg,
        debug: {
          query: srcTelemetry.lastQuery,
          companyInfoHitCount: srcTelemetry.hitCount,
          topRelevanceScore: srcTelemetry.topRelevanceScore,
          offendingAssertion: failure.offendingAssertion,
          rule: failure.rule,
        },
      });
    };

    let citationValidation = validateCitations(
      finalText,
      retrievedIds,
      retrievedCaseTitles,
    );
    let pricingValidation = validatePricingReply(
      input.userMessage,
      finalText,
    );
    const pricingTriggers = explainPricingDiscussionTrigger(
      input.userMessage,
      finalText,
    );
    if (pricingValidation.discussed || pricingTriggers.length > 0) {
      console.info('[agent-loop] pricing-mode classification', {
        conversationId,
        discussed: pricingValidation.discussed,
        triggers: pricingTriggers,
        ok: pricingValidation.ok,
        reasons: pricingValidation.ok ? [] : pricingValidation.reasons,
        userPreview: input.userMessage.slice(0, 120),
        replyPreview: finalText.slice(0, 180),
      });
    }
    let contactValidation = validateContactReply(
      input.userMessage,
      finalText,
      contactGateOptions,
    );
    let srcValidation = runSrcValidation(finalText);
    // CODE FLOOR: if the model forgot [[src]] but retrieval licenses the claim,
    // attach the matching citation instead of regenerating / SAFE_FALLBACK.
    if (!srcValidation.ok && srcValidation.rule === 'missing_src_token') {
      const repaired = repairMissingSrcCitations(finalText, retrievedSrc);
      if (repaired) {
        const repairedValidation = runSrcValidation(repaired);
        if (repairedValidation.ok) {
          console.info('[agent-loop] src citation auto-repaired', {
            conversationId,
            hitCount: retrievedSrc.size,
            preview: finalText.slice(0, 160),
          });
          finalText = repaired;
          srcValidation = repairedValidation;
        }
      }
    }
    if (
      citationValidation.ok &&
      pricingValidation.ok &&
      contactValidation.ok &&
      srcValidation.ok
    ) {
      reply = srcValidation.strippedText;
    } else {
      if (!srcValidation.ok) {
        alertSrcFailure(srcValidation, 'src_grounding_rejected');
        // Founder/company path: prefer the no-claim + Ali contact fallback.
        safeTurnFallback = COMPANY_SRC_SAFE_FALLBACK;
      }
      const feedback: string[] = [];
      if (!citationValidation.ok) {
        feedback.push(
          buildRegenerateFeedback(
            citationValidation.invalidIds,
            citationValidation.validIds,
            citationValidation.mismatchedTitles,
          ),
        );
      }
      if (!pricingValidation.ok) {
        // Pricing gate engaged on the model reply — always fall back to the
        // approved rate card (not the generic apology), even if the user ask
        // was phrased loosely ("give me the pricing again").
        safeTurnFallback = approvedPricingFallback(Boolean(input.voiceMode));
        feedback.push(
          buildPricingRegenerateFeedback(pricingValidation.reasons, {
            voiceMode: Boolean(input.voiceMode),
          }),
        );
      }
      if (!contactValidation.ok) {
        feedback.push(buildContactRegenerateFeedback(contactValidation.reasons));
      }
      if (!srcValidation.ok) {
        feedback.push(buildSrcRegenerateFeedback(srcValidation));
      }
      messages.push({
        role: 'user',
        content: feedback.join('\n\n'),
      });

      // Same retrievedIds / retrievedSrc sets — new hits on retry become valid
      input.onStage?.('validating');
      let retryText: string | null;
      try {
        retryText = await composeFinalText(composeCtx);
      } catch (err) {
        if (isTransientModelError(err)) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error('[agent-loop] transient model failure during regenerate', {
            conversationId,
            status: statusOf(err),
            error: reason,
            stack: err instanceof Error ? err.stack : undefined,
          });
          notifyJackieFailure({
            kind: 'model_overloaded',
            reason: `Transient model failure during regenerate (HTTP ${statusOf(err) ?? 'n/a'}): ${reason}`.slice(
              0,
              280,
            ),
            conversationId,
            route: 'agent-loop',
            ...alertOrg,
          });
          return {
            conversationId,
            reply: stripEmDashes(OVERLOADED_REPLY),
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
        fallbackReason = 'regenerate hit tool iteration cap';
      } else {
        citationValidation = validateCitations(
          retryText,
          retrievedIds,
          retrievedCaseTitles,
        );
        pricingValidation = validatePricingReply(
          input.userMessage,
          retryText,
        );
        contactValidation = validateContactReply(
          input.userMessage,
          retryText,
          contactGateOptions,
        );
        srcValidation = runSrcValidation(retryText);
        if (!srcValidation.ok && srcValidation.rule === 'missing_src_token') {
          const repaired = repairMissingSrcCitations(retryText, retrievedSrc);
          if (repaired) {
            const repairedValidation = runSrcValidation(repaired);
            if (repairedValidation.ok) {
              console.info('[agent-loop] src citation auto-repaired on retry', {
                conversationId,
                hitCount: retrievedSrc.size,
              });
              retryText = repaired;
              srcValidation = repairedValidation;
            }
          }
        }
        if (
          citationValidation.ok &&
          pricingValidation.ok &&
          contactValidation.ok &&
          srcValidation.ok
        ) {
          reply = srcValidation.strippedText;
        } else {
          const pricingReasons = pricingValidation.ok
            ? []
            : pricingValidation.reasons;
          const contactReasons = contactValidation.ok
            ? []
            : contactValidation.reasons;
          const invalidIds = citationValidation.ok
            ? []
            : citationValidation.invalidIds;
          const srcRule = srcValidation.ok ? null : srcValidation.rule;
          console.error('[agent-loop] response validation failed twice', {
            conversationId,
            invalidIds,
            pricingReasons,
            pricingTriggers: explainPricingDiscussionTrigger(
              input.userMessage,
              retryText,
            ),
            contactReasons,
            srcRule,
          });
          if (!srcValidation.ok) {
            alertSrcFailure(srcValidation, 'src_grounding_fallback');
            safeTurnFallback = COMPANY_SRC_SAFE_FALLBACK;
            failureAlerted = true;
          }
          reply = safeTurnFallback;
          usedFallback = true;
          fallbackReason = [
            invalidIds.length ? `citations:${invalidIds.join(',')}` : null,
            pricingReasons.length ? `pricing:${pricingReasons.join(';')}` : null,
            contactReasons.length ? `contacts:${contactReasons.join(';')}` : null,
            srcRule ? `src:${srcRule}` : null,
          ]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 280) || 'validation failed twice';
          if (!failureAlerted) {
            notifyJackieFailure({
              kind: 'validation_failed_twice',
              reason: fallbackReason,
              conversationId,
              route: 'agent-loop',
              ...alertOrg,
            });
            failureAlerted = true;
          }
        }
      }
    }
    }
  }

  timer.mark('validationGate');

  // Single ship-point normalizer (downstream of validate / regenerate / fallback).
  // TTS and chat both consume this string from the API / DB.
  // Strip any residual [[src:…]] tokens (safety net; success path already strips).
  reply = stripEmDashes(stripSrcTokens(reply));

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
  timer.mark('persistAssistant');

  if (usedFallback) {
    console.error('[agent-loop] usedFallback=true', {
      conversationId,
      reason: fallbackReason,
      citedIds: [],
    });
    if (!failureAlerted) {
      notifyJackieFailure({
        kind: 'used_fallback',
        reason: fallbackReason || 'unknown fallback',
        conversationId,
        route: 'agent-loop',
        ...alertOrg,
      });
    }
  }

  console.info('[agent-loop] turn complete', {
    conversationId,
    voiceMode: Boolean(input.voiceMode),
    conversationalNoTools,
    model,
    toolsOffered: toolsOffered.map((t) => t.name),
    toolsUsed: [...new Set(toolsUsed)],
    searched: toolsUsed.some((t) => isRetrievalTool(t)),
    tokensIn: tokens.in,
    tokensOut: tokens.out,
    ms: Date.now() - turnStartedAt,
    userPreview: input.userMessage.slice(0, 100),
  });
  timer.log('phases', {
    model,
    modelCallsMs: modelMs.calls,
    modelTotalMs: modelMs.total,
    systemPromptChars: system.length,
  });

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
