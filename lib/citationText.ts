const CASE_TAG_RE = /\[\[case:[^\]]+\]\]/gi;

/** Remove internal citation markers before displaying or speaking agent text. */
export function stripCaseTags(text: string): string {
  return text.replace(CASE_TAG_RE, '').replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Convert validated agent output into natural plain text for voice captions
 * and speech. Citation tags are removed only after validation has completed.
 */
export function cleanVoiceText(text: string): string {
  return stripCaseTags(text)
    .replace(/```(?:\w+)?\s*([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/([*_~])([^*_~]+)\1/g, '$2')
    .replace(/[*_~`]/g, '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(
      /\bready\s+for\s+download\s+(?:above|below)\b/gi,
      'ready to download in the projects panel',
    )
    .replace(
      /\bdownload\s+(it\s+)?(?:above|below)\b/gi,
      (_match, it: string | undefined) =>
        `download ${it ?? ''}in the projects panel`,
    )
    .trim();
}
