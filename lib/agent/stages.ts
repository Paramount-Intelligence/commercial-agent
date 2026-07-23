/**
 * Agent turn progress stages — emitted for voice UI progressive status.
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
