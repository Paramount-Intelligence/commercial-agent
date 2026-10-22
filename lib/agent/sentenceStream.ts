/** Incremental sentence framing for model text deltas. */
const ABBREVIATION_RE = /(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|e\.g|i\.e)|\b[A-Z])\.$/i;

function boundaryAt(text: string, index: number): number | null {
  const ch = text[index];
  if (ch === '\n') {
    const before = text.slice(0, index).trim();
    return before && !/^\s*\|/.test(before) ? index + 1 : null;
  }
  if (ch !== '.' && ch !== '!' && ch !== '?') return null;
  let end = index + 1;
  while (end < text.length && /["')\]]/.test(text[end] ?? '')) end++;
  if (end >= text.length || !/\s/.test(text[end] ?? '')) return null;
  if (ch === '.' && ABBREVIATION_RE.test(text.slice(0, index + 1))) return null;
  return end;
}

export class SentenceStream {
  private buffer = '';

  push(delta: string): string[] {
    this.buffer += delta;
    const ready: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      let end = boundaryAt(this.buffer, i);
      if (end == null) continue;
      const sentence = this.buffer.slice(start, end).trim();
      if (sentence) ready.push(sentence);
      while (end < this.buffer.length && /\s/.test(this.buffer[end] ?? '')) end++;
      start = end;
      i = end - 1;
    }
    this.buffer = this.buffer.slice(start);
    return ready;
  }

  flush(): string[] {
    const tail = this.buffer.trim();
    this.buffer = '';
    return tail ? [tail] : [];
  }
}

/** Read-only turns can omit tools because approved retrieval already ran. */
export function isActionToolTurn(
  userMessage: string,
  leadIntent: boolean,
  lastAssistantText = '',
): boolean {
  if (leadIntent) return true;
  if (
    /\b(?:one[\s-]?pager|pdf|document|download|transcript|send|share)\b/i.test(
      userMessage,
    )
  ) {
    return true;
  }
  return (
    /^(?:yes|yeah|yep|sure|please|go ahead|do it)[.!\s]*$/i.test(userMessage) &&
    /\b(?:one[\s-]?pager|pdf|document|download|transcript|send|share|contact|follow up)\b/i.test(
      lastAssistantText,
    )
  );
}
