/**
 * Tool registry + dispatch.
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
import {
  captureLeadToolDef,
  runCaptureLead,
  type CaptureLeadInput,
  type CaptureLeadToolResult,
} from './captureLead';
import {
  shareDocumentToolDef,
  runShareDocument,
  type ShareDocumentInput,
  type ShareDocumentToolResult,
} from './shareDocument';
import {
  downloadTranscriptToolDef,
  runDownloadTranscript,
  type DownloadTranscriptToolResult,
} from './downloadTranscript';
import type { SearchCasesInput } from '../../retrieval/searchCases';

export const tools = [
  searchCasesToolDef,
  searchCompanyInfoToolDef,
  generateCaseOnepagerToolDef,
  shareDocumentToolDef,
  downloadTranscriptToolDef,
  captureLeadToolDef,
];

export type ToolDispatchResult =
  | SearchCasesToolResult
  | SearchCompanyInfoToolResult
  | GenerateOnepagerToolResult
  | ShareDocumentToolResult
  | DownloadTranscriptToolResult
  | CaptureLeadToolResult;

export type { OnepagerAttachment };

export type DispatchContext = {
  /** Case IDs returned by search_cases in this conversation (anti-fabrication). */
  retrievedIds: ReadonlySet<string>;
  conversationId: string;
  agentUserId: string;
  /** True only when this or the immediately preceding user turn explicitly requested a handoff. */
  leadCaptureAuthorized?: boolean;
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
      // retrievedIds is always [] — company info never enters case citation validation
      // (src IDs travel via retrievedSrc on the tool result instead).
      return runSearchCompanyInfo(input as SearchCompanyInfoInput);

    case 'generate_case_onepager':
      return runGenerateOnepager(
        input as GenerateOnepagerInput,
        ctx?.retrievedIds ?? new Set(),
      );

    case 'share_document':
      return runShareDocument(input as ShareDocumentInput);

    case 'download_transcript':
      return runDownloadTranscript({
        retrievedIds: ctx?.retrievedIds ?? new Set(),
        conversationId: ctx?.conversationId ?? '',
        agentUserId: ctx?.agentUserId ?? '',
      });

    case 'capture_lead':
      console.info('[tools/dispatch] capture_lead → handler', {
        conversationId: ctx?.conversationId ?? null,
        agentUserId: ctx?.agentUserId ?? null,
        authorized: ctx?.leadCaptureAuthorized === true,
      });
      if (ctx?.leadCaptureAuthorized !== true) {
        return {
          modelResult: {
            ok: false,
            error:
              'Lead capture is not authorized. The user did not explicitly request contact, a meeting, or a team follow-up. Answer their current informational question instead; do not repeat a lead-confirmation prompt.',
          },
          retrievedIds: [],
        };
      }
      return runCaptureLead(input as CaptureLeadInput, {
        retrievedIds: ctx?.retrievedIds ?? new Set(),
        conversationId: ctx?.conversationId ?? '',
        agentUserId: ctx?.agentUserId ?? '',
        leadCaptureAuthorized: true,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
