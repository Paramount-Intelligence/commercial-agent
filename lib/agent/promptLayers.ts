/**
 * Editable system-prompt layers stored in PromptVersion.
 *
 * Case-index remains auto-generated (not a PromptVersion layer).
 * The [[case:ID]] citation validator in lib/agent/validator.ts is DETERMINISTIC
 * CODE and is NOT editable via any layer — even if the guardrails prompt text
 * is loosened, fabricated citations still fail validation in the agent loop.
 */
export const EDITABLE_PROMPT_LAYERS = ['base', 'guidelines', 'guardrails'] as const;

export type EditablePromptLayer = (typeof EDITABLE_PROMPT_LAYERS)[number];

export function isEditablePromptLayer(
  value: unknown,
): value is EditablePromptLayer {
  return (
    typeof value === 'string' &&
    (EDITABLE_PROMPT_LAYERS as readonly string[]).includes(value)
  );
}

export const PROMPT_LAYER_META: Record<
  EditablePromptLayer,
  { title: string; description: string }
> = {
  base: {
    title: 'Base',
    description:
      'Role, pitch-first behavior, tool-use rules, and structural instructions.',
  },
  guidelines: {
    title: 'Guidelines',
    description:
      'Tone, phrasing, and commercial emphasis Marty can tune without a deploy.',
  },
  guardrails: {
    title: 'Guardrails',
    description:
      'Safety layer: anti-fabrication, pricing, and instruction hierarchy (prompt text only).',
  },
};
