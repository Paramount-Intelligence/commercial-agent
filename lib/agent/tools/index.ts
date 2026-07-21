/**
 * Tool registry + dispatch. Add fetchAsset / captureLead / rateCard / webSearch here later.
 */
import {
  runSearchCases,
  searchCasesToolDef,
  type SearchCasesToolResult,
} from './searchCases';
import {
  runSearchCompanyInfo,
  searchCompanyInfoToolDef,
  type SearchCompanyInfoInput,
  type SearchCompanyInfoToolResult,
} from './searchCompanyInfo';
import {
  generateCaseOnepagerToolDef,
  runGenerateOnepager,
  type GenerateOnepagerInput,
  type GenerateOnepagerToolResult,
  type OnepagerAttachment,
} from './generateCaseOnepager';
import type { SearchCasesInput } from '../../retrieval/searchCases';

export const tools = [
  searchCasesToolDef,
  searchCompanyInfoToolDef,
  generateCaseOnepagerToolDef,
];

export type ToolDispatchResult =
  | SearchCasesToolResult
  | SearchCompanyInfoToolResult
  | GenerateOnepagerToolResult;

export type { OnepagerAttachment };

export type DispatchContext = {
  /** Case IDs returned by search_cases in this conversation (anti-fabrication). */
  retrievedIds: ReadonlySet<string>;
};

export async function dispatchTool(
  name: string,
  input: unknown,
  ctx?: DispatchContext,
): Promise<ToolDispatchResult> {
  switch (name) {
    case 'search_cases':
      return runSearchCases(input as SearchCasesInput);

    case 'search_company_info':
      // retrievedIds is always [] — company info never enters citation validation
      return runSearchCompanyInfo(input as SearchCompanyInfoInput);

    case 'generate_case_onepager':
      return runGenerateOnepager(
        input as GenerateOnepagerInput,
        ctx?.retrievedIds ?? new Set(),
      );

    // case 'fetch_asset':
    // case 'capture_lead':
    // case 'rate_card':
    // case 'web_search':

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
