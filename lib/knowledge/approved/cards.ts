/**
 * Which cases get a card under a reply (KNOWLEDGE_SOURCE=approved): only cases
 * the reply actually cites with a [[case:ID]] tag, that were retrieved in this
 * conversation and matched at least CARD_SIMILARITY. Pure.
 */
import { extractCitedIds } from '../../agent/validator';

export function cardCaseIds(reply: string, retrievedIds: ReadonlySet<string>, cardEligible?: ReadonlySet<string>): string[] {
  return [...new Set(extractCitedIds(reply).filter((id) => retrievedIds.has(id) && (!cardEligible || cardEligible.has(id))))];
}
