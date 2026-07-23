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
import { HARD_GUARDRAILS } from './guardrails';
import { BASE_PROMPT } from './base-prompt';
import { APPROVED_CONTACTS_PROMPT } from './contacts';
import type { EditablePromptLayer } from './promptLayers';

/**
 * Voice-register default. Marty can tune this wording here; the admin-editable
 * guidelines layer is still included above it for organization-wide guidance.
 * This layer changes delivery only and is always followed by HARD_GUARDRAILS.
 */
const VOICE_REGISTER = `You are speaking aloud in a live conversation. Phrase for the EAR: use natural spoken language and shorter sentences. Do not use markdown, bulleted or numbered lists, "Closest fit:"-style headers, or other visual formatting. Talk like a knowledgeable consultant on a phone call: warm, clear, concise, and a little shorter than a written answer.

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
  const live = await prisma.promptVersion.findFirst({
    where: { layer, isLive: true },
    orderBy: { createdAt: 'desc' },
    select: { body: true },
  });
  const body = live?.body?.trim() ?? '';
  return body.length > 0 ? body : null;
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
} = {}): Promise<string> {
  const assembled = await assembleSystemPromptDetailed(opts);
  return assembled.prompt;
}

export async function assembleSystemPromptDetailed(opts: {
  base?: string;
  guidelines?: string;
  guardrails?: string;
  voiceMode?: boolean;
} = {}): Promise<AssembledPrompt> {
  const baseResolved =
    opts.base !== undefined
      ? {
          body: opts.base.trim() || BASE_PROMPT,
          source: (opts.base.trim()
            ? 'preview-override'
            : 'code-fallback') as LayerSource,
        }
      : await loadActiveBase();

  const guidelinesOverride = opts.guidelines;
  let guidelinesBody: string;
  let guidelinesSource: LayerSource;
  if (guidelinesOverride !== undefined) {
    guidelinesBody = guidelinesOverride.trim();
    guidelinesSource = guidelinesBody ? 'preview-override' : 'empty';
  } else {
    guidelinesBody = await loadActiveGuidelines();
    guidelinesSource = guidelinesBody ? 'live-from-DB' : 'empty';
  }

  const guardrailsResolved =
    opts.guardrails !== undefined
      ? {
          body: opts.guardrails.trim() || HARD_GUARDRAILS,
          source: (opts.guardrails.trim()
            ? 'preview-override'
            : 'code-fallback') as LayerSource,
        }
      : await loadActiveGuardrails();

  // Voice turns use search tools directly, so the large discovery-only case
  // index can be omitted without weakening citation validation.
  const caseIndex = opts.voiceMode ? '' : await buildCaseIndex();
  const caseIndexSource: LayerSource = 'auto-generated';
  const shareableDocs = await buildShareableDocsCatalog();

  // Contacts reference is a code floor (like the citation validator): always
  // present even if a live DB guardrails edit omitted it.
  const guardrailsBody = guardrailsResolved.body.includes(
    'ali@paramountintelligence.co',
  )
    ? guardrailsResolved.body
    : `${guardrailsResolved.body}\n\n${APPROVED_CONTACTS_PROMPT}`;

  const layers = [
    baseMarker(baseResolved.source),
    baseResolved.body,
    '',
    guidelinesMarker(guidelinesSource),
    guidelinesBody || '(no live guidelines published yet)',
    '',
    caseIndexMarker(),
    caseIndex || '(omitted in low-latency voice mode; use search tools)',
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
