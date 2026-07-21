/**
 * Four-layer system prompt assembly.
 * Order is fixed: base → guidelines → case index → HARD_GUARDRAILS (always last).
 */
import { prisma } from '../db';
import { buildCaseIndex } from './caseIndex';
import { HARD_GUARDRAILS } from './guardrails';
import { BASE_PROMPT } from './base-prompt';

/**
 * Voice-register default. Marty can tune this wording here; the admin-editable
 * guidelines layer is still included above it for organization-wide guidance.
 * This layer changes delivery only and is always followed by HARD_GUARDRAILS.
 */
const VOICE_REGISTER = `You are speaking aloud in a live conversation. Phrase for the EAR: use natural spoken language and shorter sentences. Do not use markdown, bulleted or numbered lists, "Closest fit:"-style headers, or other visual formatting. Talk like a knowledgeable consultant on a phone call: warm, clear, concise, and a little shorter than a written answer.

Still name real cases and follow ALL evidence, tool-use, citation, anti-fabrication, and validation rules. Continue producing the required [[case:ID]] tags for every specific case; those tags are validated first and stripped only after validation, before captioning and speech.

When you generate a downloadable document, say naturally: "It's ready to download in the projects panel" or simply "It's ready to download." NEVER describe a download as "above", "below", "at the top", or in any other positional language outside the projects panel. Voice mode uses a responsive layout, so those directions are unreliable.

This instruction changes STYLE only and never weakens a guardrail.`;

/**
 * Active editable guidelines from PromptVersion (layer = 'guidelines', isLive).
 * Returns '' if none published yet.
 */
export async function loadActiveGuidelines(): Promise<string> {
  const live = await prisma.promptVersion.findFirst({
    where: { layer: 'guidelines', isLive: true },
    orderBy: { createdAt: 'desc' },
    select: { body: true },
  });
  return live?.body?.trim() ?? '';
}

export async function assembleSystemPrompt(opts: {
  guidelines?: string;
  voiceMode?: boolean;
}): Promise<string> {
  const guidelines = (opts.guidelines ?? '').trim();
  // Voice turns use search tools directly, so the large discovery-only case
  // index can be omitted without weakening citation validation.
  const caseIndex = opts.voiceMode ? '' : await buildCaseIndex();

  const layers = [
    '===== LAYER 1: BASE (git) =====',
    BASE_PROMPT,
    '',
    '===== LAYER 2: GUIDELINES (admin, editable) =====',
    guidelines || '(no live guidelines published yet)',
    '',
    '===== LAYER 3: CASE INDEX (auto-generated; not citable) =====',
    caseIndex || '(omitted in low-latency voice mode; use search tools)',
    ...(opts.voiceMode
      ? [
          '',
          '===== VOICE REGISTER (git default; style only) =====',
          VOICE_REGISTER,
        ]
      : []),
    '',
    '===== LAYER 4: HARD GUARDRAILS (git, ALWAYS LAST) =====',
    HARD_GUARDRAILS,
  ];

  return layers.join('\n');
}
