/** Stable prompt assembly. Editable layers remain independently publishable. */
import { prisma } from '../db';
import { buildShareableDocsCatalog } from './shareableDocs';
import { cached } from './promptCache';
import { HARD_GUARDRAILS } from './guardrails';
import { BASE_PROMPT } from './base-prompt';
import { GUIDELINES_PROMPT } from './guidelines';
import { channelExamples, channelPrompt } from './channelPrompt';
import type { EditablePromptLayer } from './promptLayers';
import { coreDocsPrompt, knowledgeSource } from '../knowledge/approved/catalog';

export type LayerSource =
  | 'live-from-DB'
  | 'code-fallback'
  | 'preview-override';

type ResolvedLayer = {
  body: string;
  source: LayerSource;
};

export type AssembledPrompt = {
  prompt: string;
  sources: {
    base: LayerSource;
    guidelines: LayerSource;
    guardrails: LayerSource;
  };
};

async function loadLiveLayerBody(layer: EditablePromptLayer): Promise<string | null> {
  return cached(`layer:${layer}`, async () => {
    const live = await prisma.promptVersion.findFirst({
      where: { layer, isLive: true },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });
    const body = live?.body?.trim() ?? '';
    return body || null;
  });
}

async function activeLayer(
  layer: EditablePromptLayer,
  fallback: string,
): Promise<ResolvedLayer> {
  const live = await loadLiveLayerBody(layer);
  return live
    ? { body: live, source: 'live-from-DB' }
    : { body: fallback, source: 'code-fallback' };
}

export function loadActiveBase(): Promise<ResolvedLayer> {
  return activeLayer('base', BASE_PROMPT);
}

export async function loadActiveGuidelines(): Promise<string> {
  return (await activeLayer('guidelines', GUIDELINES_PROMPT)).body;
}

export function loadActiveGuardrails(): Promise<ResolvedLayer> {
  return activeLayer('guardrails', HARD_GUARDRAILS);
}

function marker(label: string, source: LayerSource): string {
  const rendered = source === 'preview-override' ? 'preview override' : source;
  return `===== ${label} (${rendered}) =====`;
}

function resolveOverride(value: string | undefined, fallback: string): ResolvedLayer | null {
  if (value === undefined) return null;
  const body = value.trim();
  return body
    ? { body, source: 'preview-override' }
    : { body: fallback, source: 'code-fallback' };
}

export async function assembleSystemPrompt(opts: {
  base?: string;
  guidelines?: string;
  guardrails?: string;
  voiceMode?: boolean;
  /** Retained for API compatibility; Phase 3a no longer injects a case index. */
  omitCaseIndex?: boolean;
} = {}): Promise<string> {
  return (await assembleSystemPromptDetailed(opts)).prompt;
}

export async function assembleSystemPromptDetailed(opts: {
  base?: string;
  guidelines?: string;
  guardrails?: string;
  voiceMode?: boolean;
  omitCaseIndex?: boolean;
} = {}): Promise<AssembledPrompt> {
  const [base, guardrails, guidelines, shareableDocs] = await Promise.all([
    resolveOverride(opts.base, BASE_PROMPT) ?? loadActiveBase(),
    resolveOverride(opts.guardrails, HARD_GUARDRAILS) ?? loadActiveGuardrails(),
    resolveOverride(opts.guidelines, GUIDELINES_PROMPT) ??
      activeLayer('guidelines', GUIDELINES_PROMPT),
    buildShareableDocsCatalog(),
  ]);
  const core = knowledgeSource() === 'approved' ? await coreDocsPrompt() : null;
  const voiceMode = Boolean(opts.voiceMode);

  const blocks = [
    marker('IDENTITY AND KNOWLEDGE: BASE', base.source),
    base.body,
    '',
    marker('SAFETY: GUARDRAILS', guardrails.source),
    guardrails.body,
    '',
    marker('COMMERCIAL AND SHARED STYLE: GUIDELINES', guidelines.source),
    guidelines.body,
    '',
    `===== ${voiceMode ? 'VOICE' : 'CHAT'} CHANNEL (code default) =====`,
    channelPrompt(voiceMode),
    '',
    `===== ${voiceMode ? 'VOICE' : 'CHAT'} EXAMPLES (code default) =====`,
    channelExamples(voiceMode),
    '',
    '===== SHAREABLE DOCUMENTS (auto-generated) =====',
    shareableDocs,
    ...(core
      ? ['', '===== APPROVED CORE DOCUMENTS (auto-generated) =====', core.text]
      : []),
  ];

  return {
    prompt: blocks.join('\n'),
    sources: {
      base: base.source,
      guidelines: guidelines.source,
      guardrails: guardrails.source,
    },
  };
}
