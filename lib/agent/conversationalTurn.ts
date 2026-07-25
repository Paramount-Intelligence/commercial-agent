/**
 * Lightweight pre-check: obvious small-talk / greeting turns that should not
 * offer tools (and can omit the case index). Affirmations like "yes" / "tell me
 * more" are NOT matched — those often confirm an offer and need search tools.
 */
export function isConversationalNoToolsTurn(message: string): boolean {
  const raw = message.trim();
  if (!raw || raw.length > 72) return false;

  const t = raw
    .toLowerCase()
    .replace(/[^\w\s'?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Follow-ups that unlock examples / detail — keep tools available.
  if (
    /^(yes|yep|yeah|ya|sure|please|ok|okay|go ahead|show me|tell me more|walk me through|more detail|more details|the examples?|those examples?)\b/.test(
      t,
    )
  ) {
    return false;
  }

  if (
    /^(hi|hey|hello|howdy|yo|hiya)(\s+\w+){0,3}$/.test(t) ||
    /^good\s+(morning|afternoon|evening)(\s+\w+){0,2}$/.test(t)
  ) {
    return true;
  }

  if (
    /^(how are you|how're you|how are ya|how's it going|hows it going|what's up|whats up|how do you do)(\s+\w+){0,4}\??$/.test(
      t,
    )
  ) {
    return true;
  }

  if (
    /^(thanks|thank you|thx|ty|appreciate it|cheers)(\s+\w+){0,4}$/.test(t) ||
    /^(bye|goodbye|see you|talk soon|later)(\s+\w+){0,3}$/.test(t) ||
    /^(got it|cool|great|perfect|sounds good|no worries|all good|nm|never mind)(\s+\w+){0,3}$/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}
