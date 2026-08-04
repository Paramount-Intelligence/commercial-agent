/**
 * Four-layer system prompt assembly.
 * Order is fixed: base → guidelines → case index → HARD_GUARDRAILS (always last).
 *
 * Base, guidelines, and guardrails are PromptVersion-editable (one live row per
 * layer). Case-index stays auto-generated. Code constants remain the fallback
 * until a live DB version exists for that layer.
 *
 * SAFETY NET (not a limit on editing): the [[case:ID]] anti-fabrication
 * validator in lib/agent/validator.ts is DETERMINISTIC CODE and is never
 * loaded from PromptVersion. Editing the guardrails prompt cannot disable it.
 */
import { prisma } from '../db';
import { buildCaseIndex } from './caseIndex';
import { buildShareableDocsCatalog } from './shareableDocs';
import { cached } from './promptCache';
import { HARD_GUARDRAILS } from './guardrails';
import { BASE_PROMPT } from './base-prompt';
import { APPROVED_CONTACTS_PROMPT } from './contacts';
import type { EditablePromptLayer } from './promptLayers';

/**
 * Voice-register default. Marty can tune this wording here; the admin-editable
 * guidelines layer is still included above it for organization-wide guidance.
 * This layer changes delivery only and is always followed by HARD_GUARDRAILS.
 */
const VOICE_REGISTER = `You are in a live voice conversation. The reply text is shown in the on-screen transcript AND spoken aloud.

Phrase surrounding sentences for the EAR: warm, clear, concise. Do not use labeled report starters ("Closest fit:", "Straight answer:", "Here's the picture:"). Give the short answer first; offer to go deeper instead of dumping detail unprompted. For greetings and small talk, just reply — do not search. If there is no direct case match, say so briefly, mention the adjacent area in one sentence, ask if they want examples, and stop — do not list cases until they say yes.

When sharing indicative pricing categories, put the approved rates in a **markdown table** (columns: Category | Indicative range) so the transcript can render it, then add one or two short framing sentences (indicative, subject to scoping, not a firm or binding quote, and offer to connect with the Paramount team for a formal scoped quote). Do not invent rates. The speech layer will convert "$90–$200 / hour" into natural spoken dollars — you may still write standard "$90–$200 / hour" in the table cells.

Still name real cases and follow ALL evidence, tool-use, citation, anti-fabrication, and validation rules. Continue producing the required [[case:ID]] tags for every specific case; those tags are validated first and stripped only after validation, before captioning and speech.

When you generate a downloadable document, say naturally: "It's ready to download in the projects panel" or simply "It's ready to download." NEVER describe a download as "above", "below", "at the top", or in any other positional language outside the projects panel. Voice mode uses a responsive layout, so those directions are unreliable.

This instruction changes STYLE only and never weakens a guardrail.`;

export type LayerSource =
  | 'live-from-DB'
  | 'code-fallback'
  | 'empty'
  | 'auto-generated'
  | 'preview-override';

export type AssembledPrompt = {
  prompt: string;
  sources: {
    base: LayerSource;
    guidelines: LayerSource;
    caseIndex: LayerSource;
    guardrails: LayerSource;
  };
};

async function loadLiveLayerBody(
  layer: EditablePromptLayer,
): Promise<string | null> {
  return cached(`layer:${layer}`, async () => {
    const live = await prisma.promptVersion.findFirst({
      where: { layer, isLive: true },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });
    const body = live?.body?.trim() ?? '';
    return body.length > 0 ? body : null;
  });
}

/** Active editable guidelines from PromptVersion (layer = 'guidelines', isLive). */
export async function loadActiveGuidelines(): Promise<string> {
  return (await loadLiveLayerBody('guidelines')) ?? '';
}

export async function loadActiveBase(): Promise<{
  body: string;
  source: 'live-from-DB' | 'code-fallback';
}> {
  const live = await loadLiveLayerBody('base');
  if (live) return { body: live, source: 'live-from-DB' };
  return { body: BASE_PROMPT, source: 'code-fallback' };
}

export async function loadActiveGuardrails(): Promise<{
  body: string;
  source: 'live-from-DB' | 'code-fallback';
}> {
  const live = await loadLiveLayerBody('guardrails');
  if (live) return { body: live, source: 'live-from-DB' };
  return { body: HARD_GUARDRAILS, source: 'code-fallback' };
}

function baseMarker(source: LayerSource): string {
  if (source === 'live-from-DB') return '===== LAYER 1: BASE (live-from-DB) =====';
  if (source === 'preview-override') {
    return '===== LAYER 1: BASE (preview override) =====';
  }
  return '===== LAYER 1: BASE (code fallback) =====';
}

function guidelinesMarker(source: LayerSource): string {
  if (source === 'live-from-DB') {
    return '===== LAYER 2: GUIDELINES (live-from-DB) =====';
  }
  if (source === 'preview-override') {
    return '===== LAYER 2: GUIDELINES (preview override) =====';
  }
  return '===== LAYER 2: GUIDELINES (empty — no live version) =====';
}

function caseIndexMarker(): string {
  return '===== LAYER 3: CASE INDEX (auto-generated; not citable) =====';
}

function guardrailsMarker(source: LayerSource): string {
  if (source === 'live-from-DB') {
    return '===== LAYER 4: HARD GUARDRAILS (live-from-DB, ALWAYS LAST) =====';
  }
  if (source === 'preview-override') {
    return '===== LAYER 4: HARD GUARDRAILS (preview override, ALWAYS LAST) =====';
  }
  return '===== LAYER 4: HARD GUARDRAILS (code fallback, ALWAYS LAST) =====';
}

/**
 * Assemble the four-layer system prompt. Optional overrides swap a single
 * layer for admin preview without publishing.
 */
export async function assembleSystemPrompt(opts: {
  base?: string;
  guidelines?: string;
  guardrails?: string;
  voiceMode?: boolean;
  /** Skip the ~2.5k-token case index (safe when tools are also withheld). */
  omitCaseIndex?: boolean;
} = {}): Promise<string> {
  const assembled = await assembleSystemPromptDetailed(opts);
  return assembled.prompt;
}

export async function assembleSystemPromptDetailed(opts: {
  base?: string;
  guidelines?: string;
  guardrails?: string;
  voiceMode?: boolean;
  omitCaseIndex?: boolean;
} = {}): Promise<AssembledPrompt> {
  // Voice turns use search tools directly, so the large discovery-only case
  // index can be omitted without weakening citation validation. Same for
  // obvious greeting/small-talk turns where tools are withheld.
  const wantCaseIndex = !(opts.voiceMode || opts.omitCaseIndex);

  // These are independent reads — issue them together rather than in series,
  // so a cold cache costs one round-trip instead of five.
  const [baseResolved, guidelinesLive, guardrailsResolved, caseIndex, shareableDocs] =
    await Promise.all([
      opts.base !== undefined
        ? Promise.resolve({
            body: opts.base.trim() || BASE_PROMPT,
            source: (opts.base.trim()
              ? 'preview-override'
              : 'code-fallback') as LayerSource,
          })
        : loadActiveBase(),
      opts.guidelines !== undefined
        ? Promise.resolve(null)
        : loadActiveGuidelines(),
      opts.guardrails !== undefined
        ? Promise.resolve({
            body: opts.guardrails.trim() || HARD_GUARDRAILS,
            source: (opts.guardrails.trim()
              ? 'preview-override'
              : 'code-fallback') as LayerSource,
          })
        : loadActiveGuardrails(),
      wantCaseIndex ? buildCaseIndex() : Promise.resolve(''),
      buildShareableDocsCatalog(),
    ]);

  let guidelinesBody: string;
  let guidelinesSource: LayerSource;
  if (opts.guidelines !== undefined) {
    guidelinesBody = opts.guidelines.trim();
    guidelinesSource = guidelinesBody ? 'preview-override' : 'empty';
  } else {
    guidelinesBody = guidelinesLive ?? '';
    guidelinesSource = guidelinesBody ? 'live-from-DB' : 'empty';
  }

  const caseIndexSource: LayerSource = 'auto-generated';

  // Contacts reference is a code floor (like the citation validator): always
  // present even if a live DB guardrails edit omitted it.
  const guardrailsBody = guardrailsResolved.body.includes(
    'ali@paramountintelligence.co',
  )
    ? guardrailsResolved.body
    : `${guardrailsResolved.body}\n\n${APPROVED_CONTACTS_PROMPT}`;

  const caseIndexBody =
    caseIndex ||
    (opts.omitCaseIndex
      ? '(omitted for conversational turn; no tools offered)'
      : '(omitted in low-latency voice mode; use search tools)');

  const layers = [
    baseMarker(baseResolved.source),
    baseResolved.body,
    '',
    guidelinesMarker(guidelinesSource),
    guidelinesBody || '(no live guidelines published yet)',
    '',
    caseIndexMarker(),
    caseIndexBody,
    '',
    '===== SHAREABLE DOCUMENTS (auto-generated from KnowledgeEntry) =====',
    shareableDocs,
    ...(opts.voiceMode
      ? [
          '',
          '===== VOICE REGISTER (git default; style only) =====',
          VOICE_REGISTER,
        ]
      : []),
    '',
    guardrailsMarker(guardrailsResolved.source),
    guardrailsBody,
  ];

  return {
    prompt: layers.join('\n'),
    sources: {
      base: baseResolved.source,
      guidelines: guidelinesSource,
      caseIndex: caseIndexSource,
      guardrails: guardrailsResolved.source,
    },
  };
}
