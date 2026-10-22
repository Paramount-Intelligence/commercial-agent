/**
 * Agent turn loop — buffer-and-gate.
 * Non-streaming Anthropic create(); validate citations before returning to the caller.
 * Never $disconnect() here (shared long-lived prisma).
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  MessageParam,
  TextBlockParam,
  Tool,
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
  buildPricingRegenerateFeedback,
  repairPricingFraming,
  explainPricingDiscussionTrigger,
  isPricingDiscussion,
  userAsksCommercialPricing,
  validatePricingReply,
} from './pricing';
import { resolveAgentUserName } from '../auth/agentUserName';
import {
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
import { createAnthropicClient, isTransientModelError, statusOf, testSlowDelay, withRetry } from './modelClient';
import { stripEmDashes, useParamountWeVoice } from './normalizeOutput';
import { filterBuyerText } from '../safety/buyerOutput';
import { unapprovedClientNames } from '../safety/clientNames';
import {
  affirmedEntityClarification,
  buildCompanyInfoBackfillQuery,
  buildEntityMisspellingClarification,
  buildSrcRegenerateFeedback,
  needsFounderEmployerSearch,
  repairMissingSrcCitations,
  replyNeedsCompanyInfoSearch,
  shouldActivateSrcGate,
  stripSrcTokens,
  validateSrcGrounding,
  restrictedEmployerInText,
  type RetrievedSrcChunk,
  type SrcValidationResult,
} from './srcGrounding';
import { runSearchCompanyInfo } from './tools/searchCompanyInfo';
import { knowledgeSource } from '../knowledge/approved/catalog';
import { approvedFilterLists, coreSrcChunks, preRetrieve, withToolCache } from '../knowledge/approved/turn';
import { docsById } from '../knowledge/approved/catalog';
import { employerNames } from '../knowledge/approved/employers';
import {
  attributionDebugEnabled,
  buildAttributionFeedback,
  checkCaseAttribution,
  redactForLog,
  type AttributionCheck,
} from '../knowledge/approved/attributionCheck';
import { cardCaseIds } from '../knowledge/approved/cards';
import { newestHistoryFirst, VERBATIM_HISTORY_MESSAGES } from './history';
import { personaFallback, type PersonaFallbackType } from './fallbacks';
import {
  deterministicRemainderAnswers,
  dropOffendingSentences,
  replySentences,
} from './responseSalvage';
import { CHAT_TURN_REMINDER, spokenWords, trimVoiceReply, VOICE_TURN_REMINDER } from './voiceLength';
import { isActionToolTurn, SentenceStream } from './sentenceStream';

const MODEL = 'claude-sonnet-5';
/** Faster model for voice + conversational/no-tool turns (greetings, thanks). */
const FAST_MODEL = process.env.ANTHROPIC_VOICE_MODEL || 'claude-haiku-4-5';
const MAX_TOOL_ITERATIONS = 5;
const MAX_TOKENS = 1500;
const DOCUMENT_READY_CLAIM_RE =
  /\b(?:one[\s-]?pager|document|pdf)\b[\s\S]{0,100}\b(?:ready|generated|download)|\b(?:ready|generated)\b[\s\S]{0,100}\b(?:one[\s-]?pager|document|pdf|download)\b/i;
const DOCUMENT_TOOL_FEEDBACK =
  'Your proposed reply claims a one-pager/document is ready, but no successful document tool result exists in this turn. Call generate_case_onepager (for a retrieved case) or share_document (for a shareable knowledge file) now. If the request is ambiguous, ask for clarification. If generation/share fails, say so plainly. Never claim a document is ready without a successful tool result in this same turn.';
/** Model claimed a handoff without calling capture_lead — force a real tool call. */
const LEAD_SHARED_CLAIM_RE =
  /\b(?:i(?:'ve| have)? shared (?:your|the) details|shared your (?:details|info|information) with|i(?:'ve| have)? (?:notified|emailed|sent) (?:ali|marty|the (?:team|founders))|passed (?:your|the) details (?:to|along)|someone from the team will follow up)\b/i;
const LEAD_TOOL_FEEDBACK =
  'You claimed the team was notified / details were shared, but capture_lead was NOT called in this turn. Call capture_lead now with userConsented:true and the topic. Do not claim success until the tool returns ok:true. Do not re-ask for name/email/company when SESSION USER has them, confirm and pass topic only.';
const LEAD_INTENT_FORCE_FEEDBACK =
  'The user already asked for a team follow-up / email to Ali or Marty. Call capture_lead NOW with userConsented:true and the topic from their message (e.g. AWS product discussion). Confirm SESSION USER name/email/company — do not re-ask those. Brief name corrections (Marty not Mark) are fine and do not require search_company_info. Do not claim success until capture_lead returns ok:true.';
/** Reply is still gathering the handoff topic — do not force capture yet. */
const LEAD_TOPIC_CLARIFY_RE =
  /\?\s*$|^\s*(?:sure[,.]?\s+)?(?:what|which|anything|is there)\b[\s\S]{0,80}\b(?:should|shall|want|like|topic|know|tell|share|mention|pass along)\b|\bwhat would you like (?:me to|the team to)\b|\bwhat should (?:i|the team|they) know\b/i;
const COMPANY_SEARCH_FORCE_FEEDBACK =
  'The user asked about founder/company background (Bykea / Jazz / etc.). Call search_company_info NOW with a query using the canonical spelling (e.g. "Ali Azzam Bykea role employment history"). Answer from the results and attach [[src:CHUNK_ID]] on every specific role/title/tenure claim. Do NOT say you lack the detail until after searching. Do not invent co-founder status or dates.';

// 20 s per request, at most 2 retries with backoff (lib/agent/modelClient.ts).
const anthropic = createAnthropicClient();

function systemChars(system: string | TextBlockParam[]): number {
  return typeof system === 'string' ? system.length : system.reduce((n, b) => n + b.text.length, 0);
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
  /** A string (legacy), or blocks with a cache breakpoint after the stable prefix (approved). */
  system: string | TextBlockParam[];
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
  toolsOffered?: Tool[];
  /** Diagnostic: accumulates raw Anthropic call ms across iterations. */
  modelMs?: { total: number; calls: number[] };
  /** Aborts in-flight model calls when the turn deadline passes. */
  signal?: AbortSignal;
  /** Approved knowledge: case ids matched strongly enough for a card (filled by search tools too). */
  cardEligible?: Set<string>;
  /** Called only for no-tool terminal turns; false stops further early delivery. */
  onDraftSentence?: (sentence: string) => boolean | Promise<boolean>;
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
    signal,
    cardEligible,
    onDraftSentence,
  } = ctx;
  let iterations = 0;
  let usedTools = false;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    // Honest stage: first model call = thinking; after tools = composing.
    onStage?.(usedTools ? 'composing' : 'thinking');
    const callStartedAt = performance.now();
    await testSlowDelay(signal);
    const request = {
        model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(toolsOffered.length > 0 ? { tools: toolsOffered } : {}),
      } as const;
    let response: Awaited<ReturnType<typeof anthropic.messages.create>>;
    if (onDraftSentence && toolsOffered.length === 0) {
      const sentenceStream = new SentenceStream();
      let delivery = Promise.resolve(true);
      let deliveryOpen = true;
      const stream = anthropic.messages.stream(request, { signal });
      stream.on('text', (delta) => {
        for (const sentence of sentenceStream.push(delta)) {
          delivery = delivery.then(async (previous) => {
            if (!previous || !deliveryOpen) return false;
            deliveryOpen = await onDraftSentence(sentence);
            return deliveryOpen;
          });
        }
      });
      response = await stream.finalMessage();
      for (const sentence of sentenceStream.flush()) {
        delivery = delivery.then(async (previous) => {
          if (!previous || !deliveryOpen) return false;
          deliveryOpen = await onDraftSentence(sentence);
          return deliveryOpen;
        });
      }
      await delivery;
    } else {
      response = await withRetry(
        () => anthropic.messages.create(request, { signal }),
        { signal },
      );
    }
    const callMs = Math.round(performance.now() - callStartedAt);
    if (modelMs) {
      modelMs.total += callMs;
      modelMs.calls.push(callMs);
    }
    // Diagnostic: prompt size and cache use per call (latency baseline).
    console.info('[agent-loop] model call', {
      conversationId,
      model,
      iteration: iterations,
      ms: callMs,
      stopReason: response.stop_reason,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheCreationInputTokens:
        response.usage?.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
      systemPromptChars: systemChars(system),
      messageCount: messages.length,
    });

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
        if (cardEligible && 'cardEligibleIds' in result && Array.isArray(result.cardEligibleIds)) {
          for (const id of result.cardEligibleIds) cardEligible.add(id);
        }
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
  /** Turn deadline: aborts in-flight model calls (lib/agent/turnDeadline.ts). */
  signal?: AbortSignal;
  /** Receives only fully checked sentences; used by chat and voice streaming. */
  onSentence?: (sentence: string) => void;
}): Promise<{
  conversationId: string;
  reply: string;
  citedIds: string[];
  attachments: OnepagerAttachment[];
  assistantMessageId: string | null;
  usedFallback: boolean;
  tokensIn: number;
  tokensOut: number;
  modelCalls: number;
  regenerated: boolean;
  /** Tool names that ran this turn (no inputs or results). */
  toolsUsed?: string[];
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
  const approved = knowledgeSource() === 'approved';
  // Approved knowledge: retrieve before the first model call on every
  // substantive turn, in parallel with prompt and conversation loading.
  const preRetrieval = approved && !conversationalNoTools
    ? preRetrieve(input.userMessage, {
        deadlineMs: input.voiceMode ? 800 : 1_200,
        signal: input.signal,
      })
    : null;
  const filterLists = approved ? approvedFilterLists() : null;
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
  const stablePrompt = await assembleSystemPrompt({
    voiceMode: input.voiceMode,
    omitCaseIndex: conversationalNoTools,
  });
  // Approved: the stable prefix is cached; the per-user session block follows it.
  const system: string | TextBlockParam[] = approved
    ? [
        { type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: sessionProfile },
      ]
    : `${stablePrompt}\n\n${sessionProfile}`;
  timer.mark('promptAssembly');
  const leadIntent = isLeadCaptureIntent(input.userMessage);
  const companyInfoIntent = isCompanyInfoIntent(input.userMessage);
  const pricingAsk = userAsksCommercialPricing(input.userMessage);
  let fallbackType: PersonaFallbackType = pricingAsk
    ? 'pricing'
    : /\bali(?:'s|s)?\b[\s\S]{0,40}\b(?:phone|number|mobile|cell)\b/i.test(input.userMessage) ||
        isContactDiscussion(input.userMessage)
      ? 'contact'
      : leadIntent
        ? 'lead'
        : 'general';
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
  const [createdUserMsg, read, previousFallbackRows] = await Promise.all([
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
      orderBy: { createdAt: 'desc' },
      take: VERBATIM_HISTORY_MESSAGES + 1,
      select: {
        id: true,
        role: true,
        content: true,
        retrievedCaseIds: true,
        citedCaseIds: true,
      },
    }),
    prisma.message.findMany({
      where: { conversationId, role: 'assistant', usedFallback: true },
      orderBy: { createdAt: 'asc' },
      select: { content: true },
    }),
  ]);
  // The two run concurrently, so the read may or may not have seen the write.
  // Drop it either way and append it once, in its correct trailing position.
  const prior = newestHistoryFirst(read, createdUserMsg.id);
  const previousFallbackTexts = previousFallbackRows.map((row) =>
    extractAttachments(row.content).reply.trim(),
  );
  const chooseFallback = (type: PersonaFallbackType) =>
    personaFallback(type, previousFallbackTexts, agentUser, input.userMessage);
  let safeTurnFallback = chooseFallback(fallbackType);
  const stored = [
    ...prior,
    { role: 'user', content: input.userMessage, retrievedCaseIds: [], citedCaseIds: [] },
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
  const cardEligible = new Set<string>();
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
      // A case already shown as a card earlier stays card-eligible.
      for (const id of m.citedCaseIds) cardEligible.add(id);
    }
  }

  timer.mark('conversationIo');

  if (approved) {
    for (const chunk of await coreSrcChunks()) retrievedSrc.set(chunk.id, chunk);
  }
  const pre = preRetrieval ? await preRetrieval : null;
  if (pre) {
    timer.mark('preRetrieval');
    for (const id of pre.evidence.caseIds) retrievedIds.add(id);
    for (const id of pre.evidence.cardIds) cardEligible.add(id);
    for (const [id, title] of pre.evidence.caseTitles) retrievedCaseTitles.set(id, title);
    for (const chunk of pre.evidence.src) retrievedSrc.set(chunk.id, chunk);
    console.info('[agent-loop] pre-retrieval', {
      conversationId,
      ms: pre.totalMs,
      embedMs: pre.embedMs,
      sqlMs: pre.sqlMs,
      embedCached: pre.cached,
      cases: pre.evidence.caseIds,
      src: pre.evidence.src.map((c) => c.id),
      ...(pre.error ? { error: pre.error } : {}),
    });
  }

  const messages: MessageParam[] = stored.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    // Strip embedded attachment markers so the model never sees them
    content:
      m.role === 'assistant'
        ? extractAttachments(m.content).reply
        : m.content,
  }));
  if (pre?.evidence.block) {
    // Evidence rides on this turn only; the stored message stays the user's text.
    messages[messages.length - 1].content = `${input.userMessage}\n\n${pre.evidence.block}`;
  }
  // The delivery rule rides last on the turn, after any evidence: recency beats the long prompt.
  messages[messages.length - 1].content = `${messages[messages.length - 1].content}\n\n${input.voiceMode ? VOICE_TURN_REMINDER : CHAT_TURN_REMINDER}`;
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
  // A turn naming a former employer gets no case tools: a reply about that
  // employer may not mention any case, so the model cannot fetch one to link.
  const namesFormerEmployer =
    approved && Boolean(restrictedEmployerInText(input.userMessage, (filterLists ? await filterLists : null)?.formerEmployers));
  const turnTools = namesFormerEmployer
    ? ALL_TOOLS.filter((t) => t.name !== 'search_cases' && t.name !== 'generate_case_onepager')
    : ALL_TOOLS;
  const lastAssistantForTools = [...prior]
    .reverse()
    .find((m) => m.role === 'assistant')?.content ?? '';
  const actionToolTurn = isActionToolTurn(
    input.userMessage,
    leadCaptureAuthorized,
    lastAssistantForTools,
  );
  const toolsOffered: Tool[] = conversationalNoTools
    ? []
    : approved && !actionToolTurn
      ? []
      : approved
        ? withToolCache(turnTools)
        : turnTools;
  if (conversationalNoTools) {
    console.info('[agent-loop] tools withheld for conversational turn', {
      conversationId,
      userPreview: input.userMessage.slice(0, 100),
    });
  }
  const modelMs = { total: 0, calls: [] as number[] };
  const composeCtx: Parameters<typeof composeFinalText>[0] = {
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
    signal: input.signal,
    cardEligible: approved ? cardEligible : undefined,
  };

  // After "are you asking about Bykea?", prefer affirm (incl. "yeah, IKEA")
  // before re-asking on the same mishear.
  const lastAssistant = [...prior].reverse().find((m) => m.role === 'assistant');
  const confirmedEntity = affirmedEntityClarification(
    input.userMessage,
    lastAssistant?.content,
  );

  // STT misspelling (Vaikea / Shifia / IKEA / …): verify before searching.
  const entityClarify = confirmedEntity
    ? null
    : buildEntityMisspellingClarification(input.userMessage);
  if (entityClarify) {
    const clarifyLists = filterLists ? await filterLists : null;
    const clarifyReply = filterBuyerText(stripEmDashes(entityClarify.question), {
      formerEmployers: clarifyLists?.formerEmployers,
      clientNames: clarifyLists ? clarifyLists.clientNames : await unapprovedClientNames(),
      allowedEmails: agentUser?.email ? [agentUser.email] : [],
    });
    console.info('[agent-loop] entity misspelling clarification', {
      conversationId,
      heard: entityClarify.heard,
      canonical: entityClarify.canonical,
    });
    const createdMsg = await prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: clarifyReply,
        citedCaseIds: [],
        retrievedCaseIds: [],
        toolsUsed: [],
        tokensIn: 0,
        tokensOut: 0,
      },
      select: { id: true },
    });
    timer.mark('compose');
    timer.mark('validationGate');
    timer.mark('persistAssistant');
    timer.log('phases', {
      model,
      modelCallsMs: modelMs.calls,
      modelTotalMs: modelMs.total,
      systemPromptChars: systemChars(system),
    });
    console.info('[agent-loop] turn complete', {
      conversationId,
      voiceMode: Boolean(input.voiceMode),
      conversationalNoTools,
      model,
      toolsOffered: toolsOffered.map((t) => t.name),
      toolsUsed: [],
      searched: false,
      tokensIn: 0,
      tokensOut: 0,
      ms: Date.now() - turnStartedAt,
      userPreview: input.userMessage.slice(0, 100),
      clarifiedEntity: entityClarify.canonical,
    });
    return {
      conversationId,
      reply: clarifyReply,
      citedIds: [],
      attachments: [],
      assistantMessageId: createdMsg.id,
      usedFallback: false,
      tokensIn: 0,
      tokensOut: 0,
      modelCalls: 0,
      regenerated: false,
    };
  }

  const lists = filterLists ? await filterLists : null;
  // Prior-employment cases retrieved this conversation → the employer each names.
  const ownEmployerCases = approved
    ? new Map(
        [...(await docsById([...retrievedIds])).values()]
          .filter((d) => d.type === 'case' && d.attribution === 'ali-prior-employment')
          .map((d) => [d.id, employerNames(d.metadata.employer)] as const),
      )
    : undefined;

  let streamedPrefix = '';
  let sentenceDeliveryOpen = Boolean(input.onSentence);
  const onDraftSentence = input.onSentence
    ? async (sentence: string): Promise<boolean> => {
        if (!sentenceDeliveryOpen || input.signal?.aborted) return false;
        const safeSentence = useParamountWeVoice(stripEmDashes(filterBuyerText(
          sentence,
          {
            formerEmployers: lists?.formerEmployers,
            clientNames: lists?.clientNames ?? (await unapprovedClientNames()),
            allowedEmails: agentUser.email ? [agentUser.email] : [],
          },
        ))).trim();
        if (!safeSentence) return true;
        const candidate = streamedPrefix
          ? `${streamedPrefix} ${safeSentence}`
          : safeSentence;
        const citation = validateCitations(
          candidate,
          retrievedIds,
          retrievedCaseTitles,
        );
        const contact = validateContactReply(
          input.userMessage,
          candidate,
          contactGateOptions,
        );
        const pricing = validatePricingReply(input.userMessage, candidate);
        const hardPricingFailure = !pricing.ok;
        const citedCaseIds = new Set(
          extractCitedIds(candidate).filter((id) => retrievedIds.has(id)),
        );
        const src = validateSrcGrounding({
          replyText: candidate,
          retrievedSrc,
          caseRetrievedIds: retrievedIds,
          validCaseIdsInReply: citedCaseIds,
          retrievedCaseTitles,
          restrictedEmployers: lists?.formerEmployers,
          ownEmployerCases,
          gateActive: shouldActivateSrcGate({
            userMessage: input.userMessage,
            replyText: candidate,
            usedSearchCompanyInfo:
              toolsUsed.includes('search_company_info') ||
              Boolean(pre?.evidence.src.length),
          }),
        });
        const attribution = approved
          ? checkCaseAttribution(
              candidate,
              new Map(
                [...(await docsById(extractCitedIds(candidate))).values()].map(
                  (doc) => [doc.id, doc.attribution] as const,
                ),
              ),
            )
          : ({ ok: true } as const);
        if (
          !citation.ok ||
          !contact.ok ||
          hardPricingFailure ||
          !src.ok ||
          !attribution.ok
        ) {
          sentenceDeliveryOpen = false;
          console.warn('[agent-loop] held unsafe streamed sentence', {
            conversationId,
            citation: citation.ok,
            contact: contact.ok,
            pricing: !hardPricingFailure,
            src: src.ok,
            attribution: attribution.ok,
          });
          return false;
        }
        streamedPrefix = candidate;
        input.onSentence?.(safeSentence);
        return true;
      }
    : undefined;
  composeCtx.onDraftSentence = onDraftSentence;

  // 4–5. Compose (with tools) → validate → one regenerate compose if needed
  let reply: string;
  let usedFallback = false;
  let fallbackReason: string | null = null;
  const fallbackRules = new Set<string>();
  const useFallback = (type: PersonaFallbackType, rule: string): string => {
    usedFallback = true;
    fallbackReason = rule;
    fallbackRules.add(rule);
    return chooseFallback(type);
  };
  const persistOperationalFallback = async (text: string, rule: string) =>
    prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: text,
        citedCaseIds: [],
        retrievedCaseIds: [...retrievedIds],
        toolsUsed: [...new Set(toolsUsed)],
        tokensIn: tokens.in,
        tokensOut: tokens.out,
        usedFallback: true,
        fallbackRules: [rule],
      },
      select: { id: true },
    });
  let failureAlerted = false;
  let regenerated = false;
  const alertOrg = input.organization
    ? { orgId: input.organization.id, orgName: input.organization.name }
    : {};

  let finalText: string | null;
  try {
    finalText = await composeFinalText(composeCtx);
  } catch (err) {
    if (isTransientModelError(err)) {
      // Retries exhausted on a capacity/network problem — degrade gracefully.
      // Persist the buyer-visible operational fallback so repetition control
      // and admin fallback counts remain exact.
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
      const overloadReply = stripEmDashes(chooseFallback('overload'));
      const overloadMessage = await persistOperationalFallback(
        overloadReply,
        'model_overloaded',
      );
      return {
        conversationId,
        reply: overloadReply,
        citedIds: [],
        attachments: [],
        assistantMessageId: overloadMessage.id,
        usedFallback: true,
        tokensIn: tokens.in,
        tokensOut: tokens.out,
        modelCalls: modelMs.calls.length,
        regenerated,
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
    fallbackRules.add('tool_iteration_cap');
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
        finalText = useFallback('document', 'document_tool_failed');
      }
      if (
        finalText &&
        attachments.length === 0 &&
        DOCUMENT_READY_CLAIM_RE.test(finalText)
      ) {
        finalText = useFallback('document', 'document_ready_without_tool');
      }
    }

    // Founder-employer ask OR reply already asserting bio facts with no company search.
    // Skip when we already clarified a misspelling this turn (handled above).
    // After the user confirms "yes" to "are you asking about Bykea?", search Bykea.
    // Approved knowledge already put the founder and company documents in the turn.
    const shouldForceCompanySearch =
      !approved &&
      !conversationalNoTools &&
      !toolsUsed.includes('search_company_info') &&
      (Boolean(confirmedEntity) ||
        needsFounderEmployerSearch(input.userMessage) ||
        Boolean(finalText && replyNeedsCompanyInfoSearch(finalText)));
    if (finalText && shouldForceCompanySearch) {
      const entity = confirmedEntity ?? 'Bykea';
      const forceFeedback = confirmedEntity
        ? `The user confirmed they meant ${confirmedEntity}. Call search_company_info NOW with a query like "Ali Azzam ${confirmedEntity} role employment history". Answer from the results with [[src:CHUNK_ID]] on specific role/title/tenure claims. Do not say you lack the detail until after searching.`
        : COMPANY_SEARCH_FORCE_FEEDBACK;
      console.warn(
        '[agent-loop] founder-employer ask without search_company_info — forcing tool call',
        {
          conversationId,
          confirmedEntity,
          preview: input.userMessage.slice(0, 120),
          entity,
          replyAsserted: Boolean(finalText && replyNeedsCompanyInfoSearch(finalText)),
        },
      );
      messages.push({ role: 'user', content: forceFeedback });
      try {
        finalText = await composeFinalText(composeCtx);
      } catch (err) {
        if (!isTransientModelError(err)) throw err;
        finalText = useFallback('company', 'company_search_failed');
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
        finalText = useFallback('lead', 'capture_lead_failed');
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
        finalText = useFallback('lead', 'capture_lead_missing');
      }
    }

    // Explicit lead intent already authorized, but the model corrected a name /
    // chatted instead of calling capture_lead — force the tool once.
    if (
      leadCaptureAuthorized &&
      finalText &&
      !toolsUsed.includes('capture_lead') &&
      !LEAD_TOPIC_CLARIFY_RE.test(finalText)
    ) {
      console.warn(
        '[agent-loop] lead intent authorized without capture_lead — forcing tool call',
        { conversationId, preview: finalText.slice(0, 160) },
      );
      messages.push({ role: 'user', content: LEAD_INTENT_FORCE_FEEDBACK });
      try {
        finalText = await composeFinalText(composeCtx);
      } catch (err) {
        if (!isTransientModelError(err)) throw err;
        finalText = useFallback('lead', 'capture_lead_failed');
      }
      if (finalText && !toolsUsed.includes('capture_lead')) {
        console.error(
          '[agent-loop] capture_lead still missing after lead-intent force',
          { conversationId, toolsUsed },
        );
        finalText = useFallback('lead', 'capture_lead_missing');
      }
    }

    if (finalText === null) {
      reply = safeTurnFallback;
      usedFallback = true;
      fallbackReason = 'tool iteration cap exceeded after integrity regenerate';
      fallbackRules.add('tool_iteration_cap');
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
        restrictedEmployers: lists?.formerEmployers,
        ownEmployerCases,
        gateActive: shouldActivateSrcGate({
          userMessage: input.userMessage,
          replyText: text,
          usedSearchCompanyInfo:
            toolsUsed.includes('search_company_info') ||
            Boolean(pre?.evidence.src.length),
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
    // CODE FLOOR: approved figures missing only the caveat wording get the standard caveat.
    const framedPricing = repairPricingFraming(input.userMessage, finalText);
    if (framedPricing) {
      console.info('[agent-loop] pricing caveat appended', { conversationId });
      finalText = framedPricing;
      pricingValidation = validatePricingReply(input.userMessage, finalText);
    }
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
    // Approved knowledge: founder work cited as a case must keep its attribution.
    const attributionOf = async (text: string) =>
      new Map([...(await docsById(extractCitedIds(text))).values()].map((d) => [d.id, d.attribution] as const));
    const runAttributionCheck = async (text: string): Promise<AttributionCheck> => {
      const result = approved ? checkCaseAttribution(text, await attributionOf(text)) : { ok: true as const };
      // Staging only (builds of develop): the rejected sentence, for reviewing false positives.
      if (!result.ok && attributionDebugEnabled()) {
        console.warn('[agent-loop] attribution check rejected a draft (staging diagnostics)', {
          conversationId,
          rule: result.rule,
          ids: result.ids,
          sentence: redactForLog(result.sentence, [agentUser.name, agentUser.affiliation, agentUser.email]),
        });
      }
      return result;
    };
    let attributionValidation = await runAttributionCheck(finalText);
    // Staging only (builds of develop): every failing rule with its redacted
    // offending sentences, so false positives can be reviewed. Never on main.
    const logRejectedDraft = (draft: 'first' | 'retry', text: string) => {
      if (!attributionDebugEnabled()) return;
      const personal = [agentUser.name, agentUser.affiliation, agentUser.email];
      const sentencesFailing = (check: (s: string) => boolean) =>
        replySentences(text).filter(check).map((s) => redactForLog(s.slice(0, 220), personal));
      const rules: Array<{ rule: string; sentences: string[] }> = [];
      if (!citationValidation.ok) {
        rules.push({ rule: 'case_citation', sentences: citationValidation.offendingSentences.map((s) => redactForLog(s.sentence.slice(0, 220), personal)) });
      }
      if (!pricingValidation.ok) {
        rules.push({ rule: `pricing: ${pricingValidation.reasons.join('; ')}`, sentences: sentencesFailing((s) => !validatePricingReply(input.userMessage, s).ok) });
      }
      if (!contactValidation.ok) {
        rules.push({ rule: `contacts: ${contactValidation.reasons.join('; ')}`, sentences: sentencesFailing((s) => !validateContactReply(input.userMessage, s, contactGateOptions).ok) });
      }
      if (!srcValidation.ok) {
        rules.push({ rule: `src: ${srcValidation.rule}`, sentences: [redactForLog(srcValidation.offendingAssertion.slice(0, 220), personal)] });
      }
      if (!attributionValidation.ok) {
        rules.push({ rule: `attribution: ${attributionValidation.rule}`, sentences: [redactForLog(attributionValidation.sentence, personal)] });
      }
      if (rules.length) {
        console.warn('[agent-loop] draft rejected (staging diagnostics)', { conversationId, draft, rules: JSON.stringify(rules) });
      }
    };
    // CODE FLOOR: if the model forgot [[src]] but retrieval licenses the claim,
    // attach the matching citation instead of regenerating / SAFE_FALLBACK.
    // When search_company_info never ran (or returned 0), backfill from the
    // ContentChunk corpus using entities named in the reply — then repair.
    const trySrcRepair = async (text: string): Promise<string | null> => {
      let repaired = repairMissingSrcCitations(text, retrievedSrc);
      if (repaired) return repaired;
      if (!replyNeedsCompanyInfoSearch(text)) return null;
      const query = buildCompanyInfoBackfillQuery(text, input.userMessage);
      if (!query) return null;
      try {
        const backfill = await runSearchCompanyInfo({ query, limit: 5 });
        for (const chunk of backfill.retrievedSrc) {
          retrievedSrc.set(chunk.id, chunk);
        }
        srcTelemetry.hitCount = retrievedSrc.size;
        const scores = [...retrievedSrc.values()].map((c) => c.sim);
        srcTelemetry.topRelevanceScore =
          scores.length > 0 ? Math.max(...scores) : null;
        srcTelemetry.lastQuery = backfill.query || query;
        if (!toolsUsed.includes('search_company_info')) {
          toolsUsed.push('search_company_info');
        }
        console.info('[agent-loop] company-info backfill for src repair', {
          conversationId,
          query: srcTelemetry.lastQuery,
          hitCount: retrievedSrc.size,
          topRelevanceScore: srcTelemetry.topRelevanceScore,
        });
      } catch (err) {
        console.error('[agent-loop] company-info backfill failed', {
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
      return repairMissingSrcCitations(text, retrievedSrc);
    };

    if (!srcValidation.ok && srcValidation.rule === 'missing_src_token') {
      const repaired = await trySrcRepair(finalText);
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
      srcValidation.ok &&
      attributionValidation.ok
    ) {
      reply = srcValidation.strippedText;
    } else {
      if (!srcValidation.ok) {
        alertSrcFailure(srcValidation, 'src_grounding_rejected');
        // Founder/company path: prefer the no-claim + Ali contact fallback.
        fallbackType = 'company';
        safeTurnFallback = chooseFallback(fallbackType);
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
        fallbackType = 'pricing';
        safeTurnFallback = chooseFallback(fallbackType);
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
      if (!attributionValidation.ok) {
        feedback.push(buildAttributionFeedback(attributionValidation, await attributionOf(finalText)));
      }
      logRejectedDraft('first', finalText);
      // Rule names only (no reply text): which gate asked for the regenerate.
      console.warn('[agent-loop] reply rejected, regenerating', {
        conversationId,
        citations: citationValidation.ok ? null : citationValidation.invalidIds,
        pricing: !pricingValidation.ok,
        contacts: !contactValidation.ok,
        src: srcValidation.ok ? null : srcValidation.rule,
        attribution: attributionValidation.ok ? null : attributionValidation.ids,
      });
      messages.push({
        role: 'user',
        content: feedback.join('\n\n'),
      });

      // Same retrievedIds / retrievedSrc sets — new hits on retry become valid
      input.onStage?.('validating');
      regenerated = true;
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
          const overloadReply = stripEmDashes(chooseFallback('overload'));
          const overloadMessage = await persistOperationalFallback(
            overloadReply,
            'model_overloaded',
          );
          return {
            conversationId,
            reply: overloadReply,
            citedIds: [],
            attachments: [],
            assistantMessageId: overloadMessage.id,
            usedFallback: true,
            tokensIn: tokens.in,
            tokensOut: tokens.out,
            modelCalls: modelMs.calls.length,
            regenerated,
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
        fallbackRules.add('tool_iteration_cap');
      } else {
        citationValidation = validateCitations(
          retryText,
          retrievedIds,
          retrievedCaseTitles,
        );
        const framedRetry = repairPricingFraming(input.userMessage, retryText);
        if (framedRetry) retryText = framedRetry;
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
        attributionValidation = await runAttributionCheck(retryText);
        if (!srcValidation.ok && srcValidation.rule === 'missing_src_token') {
          const repaired = await trySrcRepair(retryText);
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
          srcValidation.ok &&
          attributionValidation.ok
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
          logRejectedDraft('retry', retryText);
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
          const offending = new Set<string>();
          if (!citationValidation.ok) {
            for (const span of citationValidation.offendingSentences) {
              offending.add(span.sentence);
            }
          }
          for (const sentence of replySentences(retryText)) {
            if (
              !pricingValidation.ok &&
              !validatePricingReply(input.userMessage, sentence).ok
            ) {
              offending.add(sentence);
            }
            if (
              !contactValidation.ok &&
              !validateContactReply(input.userMessage, sentence, contactGateOptions).ok
            ) {
              offending.add(sentence);
            }
          }
          if (!srcValidation.ok) offending.add(srcValidation.offendingAssertion);
          if (!attributionValidation.ok) offending.add(attributionValidation.sentence);

          let salvaged = dropOffendingSentences(retryText, [...offending]);
          // A bridge can span sentences: keep dropping what the src rule names, a few rounds at most.
          for (let round = 0; round < 3; round++) {
            const again = runSrcValidation(salvaged);
            if (again.ok || again.rule === 'missing_src_token') break;
            const next = dropOffendingSentences(salvaged, [again.offendingAssertion]);
            if (next === salvaged) break;
            offending.add(again.offendingAssertion);
            salvaged = next;
          }
          const salvageCitation = validateCitations(
            salvaged,
            retrievedIds,
            retrievedCaseTitles,
          );
          const salvagePricing = validatePricingReply(input.userMessage, salvaged);
          const salvageContact = validateContactReply(
            input.userMessage,
            salvaged,
            contactGateOptions,
          );
          const salvageSrc = runSrcValidation(salvaged);
          const salvageAttribution = await runAttributionCheck(salvaged);
          const salvageAnswers = deterministicRemainderAnswers(
            input.userMessage,
            salvaged,
          );
          const shipSalvage =
            salvageAnswers &&
            salvageCitation.ok &&
            salvagePricing.ok &&
            salvageContact.ok &&
            salvageSrc.ok &&
            salvageAttribution.ok;

          if (shipSalvage) {
            reply = salvageSrc.strippedText;
            console.warn('[agent-loop] shipped sentence-level salvage', {
              conversationId,
              removedSentences: offending.size,
            });
          } else {
          if (!srcValidation.ok) {
            alertSrcFailure(srcValidation, 'src_grounding_fallback');
            fallbackType = 'company';
            safeTurnFallback = chooseFallback(fallbackType);
            failureAlerted = true;
          }
          reply = safeTurnFallback;
          usedFallback = true;
          fallbackReason = [
            invalidIds.length ? `citations:${invalidIds.join(',')}` : null,
            pricingReasons.length ? `pricing:${pricingReasons.join(';')}` : null,
            contactReasons.length ? `contacts:${contactReasons.join(';')}` : null,
            srcRule ? `src:${srcRule}` : null,
            attributionValidation.ok ? null : `attribution:${attributionValidation.ids.join(',')}`,
          ]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 280) || 'validation failed twice';
          if (invalidIds.length) fallbackRules.add('case_citation');
          if (pricingReasons.length) fallbackRules.add('pricing');
          if (contactReasons.length) fallbackRules.add('contacts');
          if (srcRule) fallbackRules.add(srcRule);
          if (!attributionValidation.ok) fallbackRules.add(attributionValidation.rule);
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
  }

  timer.mark('validationGate');

  // Single ship-point normalizer (downstream of validate / regenerate / fallback).
  // TTS and chat both consume this string from the API / DB.
  // Strip any residual [[src:…]] tokens (safety net; success path already strips).
  reply = useParamountWeVoice(stripEmDashes(stripSrcTokens(reply)));

  // Voice backstop: a validated reply that still runs long keeps its first whole
  // sentences, but only if the gates and the remainder check still pass on it.
  // Counted after the dash normalizer, which can split one word into three.
  if (input.voiceMode && !usedFallback) {
    const trimmed = trimVoiceReply(reply);
    if (
      trimmed !== reply &&
      validatePricingReply(input.userMessage, trimmed).ok &&
      validateContactReply(input.userMessage, trimmed, contactGateOptions).ok &&
      // Answer-first: the trim keeps the opening, so only require what the full reply met.
      (!deterministicRemainderAnswers(input.userMessage, reply) || deterministicRemainderAnswers(input.userMessage, trimmed))
    ) {
      console.info('[agent-loop] voice reply trimmed', {
        conversationId,
        words: spokenWords(reply),
        keptWords: spokenWords(trimmed),
      });
      reply = trimmed;
    }
  }

  // Buyer-output safety filter (former employers as clients, contacts,
  // unapproved client names) before the reply is stored or shown.
  reply = filterBuyerText(reply, {
    clientNames: lists ? lists.clientNames : await unapprovedClientNames(),
    formerEmployers: lists?.formerEmployers,
    allowedEmails: agentUser?.email ? [agentUser.email] : [],
  });

  // 6. Persist assistant Message (attachments embedded for history resume)
  input.signal?.throwIfAborted();
  const citedIds = usedFallback
    ? []
    : // Approved knowledge: cards only for cases the reply cites and that matched ≥ CARD_SIMILARITY.
      cardCaseIds(reply, retrievedIds, approved ? cardEligible : undefined);

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
      usedFallback,
      fallbackRules: [...fallbackRules],
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
    systemPromptChars: systemChars(system),
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
    modelCalls: modelMs.calls.length,
    regenerated,
    toolsUsed: [...toolsUsed],
  };
}
