/**
 * Branded conversation transcript HTML for founder lead handoff PDFs.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export type TranscriptTurn = {
  role: 'user' | 'assistant';
  text: string;
  createdAt: Date;
};

export type ReferencedCase = {
  title: string;
  url?: string;
};

export type ReferencedOnepager = {
  caseTitle: string;
  url: string;
  format: string;
};

export type ConversationPdfInput = {
  leadName: string;
  leadEmail: string;
  leadCompany?: string | null;
  topic: string;
  conversationId: string;
  generatedAt: Date;
  turns: TranscriptTurn[];
  cases: ReferencedCase[];
  onepagers: ReferencedOnepager[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadLogoDataUri(): string | null {
  const logoPath = path.join(process.cwd(), 'public', 'images', 'logo.png');
  if (!existsSync(logoPath)) return null;
  try {
    return `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`;
  } catch {
    return null;
  }
}

function formatWhen(d: Date): string {
  return d.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';
}

export function buildConversationTranscriptHtml(
  input: ConversationPdfInput,
): string {
  const logo = loadLogoDataUri();
  const brand = logo
    ? `<img class="logo" src="${logo}" alt="Paramount Intelligence" />`
    : `<div class="wordmark">PARAMOUNT INTELLIGENCE</div>`;

  const turnsHtml = input.turns
    .map((t) => {
      const label = t.role === 'user' ? 'Prospect' : 'Jackie';
      const cls = t.role === 'user' ? 'turn-user' : 'turn-agent';
      return `<article class="turn ${cls}">
  <header><span class="who">${label}</span><time>${escapeHtml(formatWhen(t.createdAt))}</time></header>
  <p>${escapeHtml(t.text).replace(/\n/g, '<br/>')}</p>
</article>`;
    })
    .join('\n');

  const casesHtml =
    input.cases.length === 0
      ? '<p class="muted">No case studies referenced.</p>'
      : `<ul>${input.cases
          .map((c) => {
            const title = escapeHtml(c.title);
            return c.url
              ? `<li><a href="${escapeHtml(c.url)}">${title}</a></li>`
              : `<li>${title}</li>`;
          })
          .join('')}</ul>`;

  const docsHtml =
    input.onepagers.length === 0
      ? '<p class="muted">No one-pagers generated.</p>'
      : `<ul>${input.onepagers
          .map(
            (d) =>
              `<li><a href="${escapeHtml(d.url)}">${escapeHtml(d.caseTitle)} (${escapeHtml(d.format.toUpperCase())})</a></li>`,
          )
          .join('')}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Conversation — ${escapeHtml(input.leadName)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Calibri, Arial, sans-serif;
    color: #0d1f3c;
    font-size: 11pt;
    line-height: 1.45;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    border-bottom: 2px solid #1e6fd9;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .logo { height: 42px; width: auto; }
  .wordmark { font-weight: 700; letter-spacing: .04em; color: #1559b4; }
  .eyebrow {
    margin: 0 0 4px;
    font-size: 9pt;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: #1e6fd9;
    font-weight: 600;
  }
  h1 { margin: 0; font-size: 16pt; }
  .meta { margin: 14px 0 22px; }
  .meta dl {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 6px 12px;
    margin: 0;
  }
  .meta dt { color: #6b7a96; font-weight: 600; font-size: 9.5pt; }
  .meta dd { margin: 0; }
  h2 {
    margin: 22px 0 10px;
    font-size: 11pt;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #1559b4;
    border-bottom: 1px solid #d7e3f4;
    padding-bottom: 4px;
  }
  .turn {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 8px;
    page-break-inside: avoid;
  }
  .turn-user { background: #f4f7fb; border-left: 3px solid #94a3b8; }
  .turn-agent { background: #eef5ff; border-left: 3px solid #1e6fd9; }
  .turn header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6px;
    font-size: 9pt;
    color: #6b7a96;
  }
  .who { font-weight: 700; color: #0d1f3c; text-transform: uppercase; letter-spacing: .04em; }
  .turn p { margin: 0; white-space: pre-wrap; }
  .muted { color: #6b7a96; font-style: italic; }
  ul { margin: 0; padding-left: 18px; }
  a { color: #1559b4; }
  .footer {
    margin-top: 28px;
    padding-top: 10px;
    border-top: 1px solid #d7e3f4;
    font-size: 8.5pt;
    color: #6b7a96;
  }
</style>
</head>
<body>
  <header class="header">
    <div>
      <p class="eyebrow">Paramount Intelligence · Lead handoff</p>
      <h1>Conversation transcript</h1>
    </div>
    ${brand}
  </header>

  <section class="meta">
    <dl>
      <dt>Name</dt><dd>${escapeHtml(input.leadName)}</dd>
      <dt>Email</dt><dd>${escapeHtml(input.leadEmail)}</dd>
      <dt>Company</dt><dd>${escapeHtml(input.leadCompany?.trim() || '—')}</dd>
      <dt>Topic</dt><dd>${escapeHtml(input.topic)}</dd>
      <dt>Generated</dt><dd>${escapeHtml(formatWhen(input.generatedAt))}</dd>
      <dt>Conversation</dt><dd><code>${escapeHtml(input.conversationId)}</code></dd>
    </dl>
  </section>

  <h2>Transcript</h2>
  ${turnsHtml || '<p class="muted">No messages.</p>'}

  <h2>Referenced case studies</h2>
  ${casesHtml}

  <h2>One-pagers &amp; downloads</h2>
  ${docsHtml}

  <p class="footer">
    Generated by the Paramount Intelligence commercial adviser for internal follow-up.
    Do not forward externally without review.
  </p>
</body>
</html>`;
}
