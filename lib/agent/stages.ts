/**
 * Agent turn progress stages — emitted for chat/voice progressive status.
 * Visual only; spoken filler stays a single fixed line.
 */
export const AGENT_STAGES = [
  'thinking',
  'searching',
  'composing',
  'validating',
] as const;

export type AgentStage = (typeof AGENT_STAGES)[number];

export type AgentStageHandler = (stage: AgentStage) => void;

/** Tools that mean "looking through our work / retrieval". */
export function isRetrievalTool(name: string): boolean {
  return (
    name === 'search_cases' ||
    name === 'search_company_info'
  );
}

/**
 * Claude-style thinking labels for the chat pending bubble (and voice pill).
 * Driven by real `stage` events when streamStages is on.
 */
export const THINKING_STATUS: Record<
  AgentStage,
  { label: string; hint: string }
> = {
  thinking: {
    label: 'Thinking',
    hint: 'Working through what you asked',
  },
  searching: {
    label: 'Searching our work',
    hint: 'Looking through case studies and company info',
  },
  composing: {
    label: 'Putting it together',
    hint: 'Shaping a clear answer for you',
  },
  validating: {
    label: 'Double-checking',
    hint: 'Making sure this stays accurate',
  },
};

/** Soft visual advance if stage events are delayed — never fakes "searching". */
export const THINKING_FALLBACK_MS = {
  composing: 5_500,
} as const;

export function isAgentStage(value: string): value is AgentStage {
  return (AGENT_STAGES as readonly string[]).includes(value);
}
