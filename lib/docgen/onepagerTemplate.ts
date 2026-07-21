/**
 * Branded one-pager HTML — 13.333in × 7.5in widescreen slide.
 * Layout: navy rail + light content; tech strip follows with a moderate gap
 * (spacer is capped so short content doesn't leave a large empty band).
 *
 * Logo is inlined as base64 so serverless Chromium needs no network fetch.
 * Fonts: Montserrat via Google Fonts + Calibri/Arial fallback; wait for fonts.ready in render.
 *
 * Later seams:
 *  (D) chat trigger → generate_case_onepager tool (done in agent loop)
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { OnepagerContent } from './mapCaseToOnepager';

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
    const buf = readFileSync(logoPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function bulletsHtml(items: string[]): string {
  if (items.length === 0) return '';
  return `<ul>${items.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`;
}

/**
 * Build the full HTML document for a one-pager from mapped content.
 */
export function buildOnepagerHtml(content: OnepagerContent): string {
  const logo = loadLogoDataUri();
  const brandBlock = logo
    ? `<img class="logo" src="${logo}" alt="Paramount Intelligence" />`
    : `<div class="wordmark">PARAMOUNT<br/><span>INTELLIGENCE</span></div>`;

  // NOTE: logo.png is blue/silver — on navy rail it may need a light/white variant later.
  // For now we render as-is; if contrast is weak, swap to a white logo asset.

  const density = content.density || 'balanced';

  const summaryHtml = content.summary
    ? `<p class="summary">${escapeHtml(content.summary)}</p>`
    : '';

  const challengeHtml = content.challenge
    ? `<section class="challenge">
        <h2>THE CHALLENGE</h2>
        <p>${escapeHtml(content.challenge)}</p>
      </section>`
    : '';

  const solutionHtml =
    content.solutionBullets.length > 0
      ? `<div class="col">
          <h2>OUR SOLUTION</h2>
          ${bulletsHtml(content.solutionBullets)}
        </div>`
      : '';

  const outcomesHtml =
    content.outcomeBullets.length > 0
      ? `<div class="col">
          <h2>KEY OUTCOMES</h2>
          ${bulletsHtml(content.outcomeBullets)}
        </div>`
      : '';

  const twoCol =
    solutionHtml || outcomesHtml
      ? `<div class="two-col">${solutionHtml}${outcomesHtml}</div>`
      : '';

  const uniqueHtml = content.uniqueLine
    ? `<section class="unique">
        <h2>WHAT MADE IT UNIQUE</h2>
        <p>${escapeHtml(content.uniqueLine)}</p>
      </section>`
    : '';

  const techHtml =
    content.techItems.length > 0
      ? `<div class="tech"><span class="tech-label">TECHNOLOGY</span><span class="tech-items">${escapeHtml(content.techItems.join(' · '))}</span></div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(content.title)} — One-pager</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  @page {
    size: 13.333in 7.5in;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 13.333in;
    height: 7.5in;
    overflow: hidden;
    font-family: 'Montserrat', Calibri, Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .slide {
    width: 13.333in;
    height: 7.5in;
    display: flex;
    flex-direction: row;
    background: #EEF3FA;
  }

  /* ——— Left navy rail ——— */
  .rail {
    width: 4.55in;
    flex-shrink: 0;
    background: #060D1A;
    border-right: 4px solid #1E6FD9;
    padding: 0.45in 0.4in 0.4in;
    display: flex;
    flex-direction: column;
    color: #EEF3FA;
  }
  .logo {
    width: 2.1in;
    height: auto;
    object-fit: contain;
    margin-bottom: 0.35in;
    /* logo is blue/silver — sits on navy; swap to white variant if needed */
  }
  .wordmark {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.18em;
    line-height: 1.35;
    color: #EEF3FA;
    margin-bottom: 0.4in;
  }
  .wordmark span { color: #6BA8FF; }
  .eyebrow {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.22em;
    color: #3B88F5;
    text-transform: uppercase;
    margin-bottom: 0.18in;
  }
  .title {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.25;
    color: #FFFFFF;
    letter-spacing: -0.01em;
    margin-bottom: 0.35in;
  }
  .client-block {
    margin-top: auto;
    padding-top: 0.3in;
    border-top: 1px solid rgba(59,136,245,0.35);
  }
  .meta-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 0.18in;
  }
  .meta-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: #8FA4C4;
    text-transform: uppercase;
  }
  .meta-value {
    font-size: 12px;
    font-weight: 500;
    color: #C9D6EA;
    line-height: 1.35;
  }

  /* ——— Right content ——— */
  .content {
    flex: 1;
    min-width: 0;
    padding: 0.42in 0.48in 0.32in;
    display: flex;
    flex-direction: column;
    background: #EEF3FA;
    color: #0B1B33;
  }
  .summary {
    font-size: 13px;
    font-weight: 500;
    font-style: italic;
    line-height: 1.45;
    color: #1E4D8C;
    margin-bottom: 0.18in;
  }
  .divider {
    height: 2px;
    width: 1.1in;
    background: #1E6FD9;
    margin-bottom: 0.18in;
  }
  .challenge h2,
  .col h2,
  .unique h2 {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: #1E6FD9;
    text-transform: uppercase;
    margin-bottom: 0.1in;
  }
  .challenge p {
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.45;
    color: #0B1B33;
    margin-bottom: 0.18in;
  }
  .unique {
    margin-top: 0.12in;
  }
  .unique p {
    font-size: 12px;
    font-weight: 500;
    line-height: 1.45;
    color: #0B1B33;
  }
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.32in;
  }
  .col ul {
    list-style: none;
    padding: 0;
  }
  .col li {
    position: relative;
    padding-left: 0.18in;
    margin-bottom: 0.09in;
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.4;
    color: #0B1B33;
  }
  .col li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.28em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #1E6FD9;
  }

  /* Fixed modest gap — never flex-grow (avoids a large empty band above tech) */
  .spacer {
    flex: 0 0 auto !important;
    flex-grow: 0 !important;
    height: 0.16in;
    max-height: 0.16in;
  }

  /* Density: short content breathes into the page; wordy stays compact */
  .content.density-roomy .summary { line-height: 1.6; margin-bottom: 0.26in; }
  .content.density-roomy .divider { margin-bottom: 0.26in; }
  .content.density-roomy .challenge { margin-bottom: 0.08in; }
  .content.density-roomy .challenge p { line-height: 1.6; margin-bottom: 0.28in; }
  .content.density-roomy .col li { margin-bottom: 0.15in; line-height: 1.55; }
  .content.density-roomy .unique { margin-top: 0.2in; }
  .content.density-roomy .unique p { line-height: 1.55; }
  .content.density-roomy .spacer { height: 0.2in; max-height: 0.2in; }
  .content.density-roomy .two-col { gap: 0.4in; margin-top: 0.04in; }

  .content.density-tight .summary { margin-bottom: 0.12in; line-height: 1.38; }
  .content.density-tight .challenge p { margin-bottom: 0.12in; line-height: 1.38; font-size: 12px; }
  .content.density-tight .col li { margin-bottom: 0.065in; line-height: 1.32; font-size: 11px; }
  .content.density-tight .spacer { height: 0.1in; max-height: 0.1in; }
  .content.density-tight .two-col { gap: 0.26in; }

  /* Tech follows content; leftover page space sits below the strip */
  .tech {
    display: flex;
    align-items: baseline;
    gap: 0.2in;
    margin-top: 0 !important;
    padding-top: 0.14in;
    border-top: 1px solid #C9D6EA;
    flex: 0 0 auto;
  }
  .tech-label {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.16em;
    color: #1E6FD9;
    text-transform: uppercase;
  }
  .tech-items {
    font-size: 10.5px;
    font-weight: 500;
    color: #1E4D8C;
    line-height: 1.35;
  }
</style>
</head>
<body>
  <div class="slide">
    <aside class="rail">
      ${brandBlock}
      <div class="eyebrow">CASE STUDY</div>
      <h1 class="title">${escapeHtml(content.title)}</h1>
      <div class="client-block">
        <div class="meta-row">
          <span class="meta-label">Client</span>
          <span class="meta-value">${escapeHtml(content.client)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Industry</span>
          <span class="meta-value">${escapeHtml(content.industry)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Market</span>
          <span class="meta-value">${escapeHtml(content.market)}</span>
        </div>
      </div>
    </aside>
    <main class="content density-${escapeHtml(density)}">
      ${summaryHtml}
      ${summaryHtml ? '<div class="divider"></div>' : ''}
      ${challengeHtml}
      ${twoCol}
      ${uniqueHtml}
      <div class="spacer"></div>
      ${techHtml}
    </main>
  </div>
</body>
</html>`;
}
