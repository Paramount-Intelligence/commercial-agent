/**
 * Editable system-prompt layers stored in PromptVersion.
 *
 * Channel instructions, examples, catalogs, and core documents are generated.
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
      'Identity, persona, knowledge use, and action rules.',
  },
  guidelines: {
    title: 'Guidelines',
    description:
      'Commercial behavior and shared style Marty can tune without a deploy.',
  },
  guardrails: {
    title: 'Guardrails',
    description:
      'Zero-tolerance attribution, confidentiality, pricing, contact, and action rules.',
  },
};
