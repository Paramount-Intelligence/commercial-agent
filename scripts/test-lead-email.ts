/**
 * Unit tests for lead geo formatting + notification email IF-blocks.
 * No DB, no SMTP.
 *
 *   npx tsx scripts/test-lead-email.ts
 */
import {
  decodeVercelCity,
  formatApproxLocation,
  leadGeoFromHeaders,
  approxLocationDisplay,
  LOCATION_UNAVAILABLE,
} from '../lib/leads/geo';
import {
  applyIfBlocks,
  emailSafePublicUrl,
  fillTokens,
  renderLeadNotificationHtml,
  renderLeadNotificationText,
} from '../lib/email/leadNotificationTemplate';
import { leadNotifyRecipients, LEAD_CONFIG } from '../lib/leads/config';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

class FakeHeaders {
  private map = new Map<string, string>();
  constructor(init?: Record<string, string>) {
    for (const [k, v] of Object.entries(init ?? {})) {
      this.map.set(k.toLowerCase(), v);
    }
  }
  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }
}

function main() {
  console.log('=== lead geo ===\n');

  check(
    'decodeURIComponent city San%20Francisco → San Francisco',
    decodeVercelCity('San%20Francisco') === 'San Francisco',
  );
  check(
    'decode already-decoded city',
    decodeVercelCity('Boston') === 'Boston',
  );
  check('decode null → null', decodeVercelCity(null) === null);

  check(
    'full headers → Boston · Massachusetts · US',
    formatApproxLocation({
      city: 'Boston',
      region: 'MA',
      country: 'US',
    }) === 'Boston · Massachusetts · US',
  );

  check(
    'country only → US (no stray separators)',
    formatApproxLocation({ country: 'US' }) === 'US',
  );

  check(
    'city + country, no region',
    formatApproxLocation({ city: 'Paris', country: 'FR' }) === 'Paris · FR',
  );

  check(
    'all absent → null',
    formatApproxLocation({}) === null,
  );

  check(
    'null approxLocation → Location unavailable',
    approxLocationDisplay(null) === LOCATION_UNAVAILABLE,
  );

  {
    const geo = leadGeoFromHeaders(
      new FakeHeaders({
        'x-vercel-ip-city': 'San%20Francisco',
        'x-vercel-ip-country-region': 'CA',
        'x-vercel-ip-country': 'US',
      }),
    );
    check(
      'headers present → approxLocation formatted + city de-encoded',
      geo.geoCity === 'San Francisco' &&
        geo.geoRegion === 'CA' &&
        geo.geoCountry === 'US' &&
        geo.approxLocation === 'San Francisco · California · US',
      geo.approxLocation ?? undefined,
    );
  }

  {
    const geo = leadGeoFromHeaders(new FakeHeaders());
    check(
      'headers absent (local) → all null, no crash',
      geo.geoCity === null &&
        geo.geoRegion === null &&
        geo.geoCountry === null &&
        geo.approxLocation === null,
    );
  }

  {
    const prev = process.env.LEAD_GEO_OVERRIDE;
    process.env.LEAD_GEO_OVERRIDE = 'Boston|MA|US';
    const geo = leadGeoFromHeaders(new FakeHeaders());
    check(
      'LEAD_GEO_OVERRIDE fills local smoke location',
      geo.approxLocation === 'Boston · Massachusetts · US',
      geo.approxLocation ?? undefined,
    );
    if (prev === undefined) delete process.env.LEAD_GEO_OVERRIDE;
    else process.env.LEAD_GEO_OVERRIDE = prev;
  }

  {
    const prev = process.env.LEAD_GEO_OVERRIDE;
    process.env.LEAD_GEO_OVERRIDE = 'Ignored|XX|US';
    const geo = leadGeoFromHeaders(
      new FakeHeaders({
        'x-vercel-ip-city': 'Paris',
        'x-vercel-ip-country': 'FR',
      }),
    );
    check(
      'real Vercel headers win over LEAD_GEO_OVERRIDE',
      geo.approxLocation === 'Paris · FR',
      geo.approxLocation ?? undefined,
    );
    if (prev === undefined) delete process.env.LEAD_GEO_OVERRIDE;
    else process.env.LEAD_GEO_OVERRIDE = prev;
  }

  console.log('\n=== email IF-blocks + template ===\n');

  check(
    'IF phone omitted when empty',
    !applyIfBlocks(
      'A<!-- IF phone -->PHONE:{{phone}}<!-- ENDIF phone -->B',
      { phone: '' },
    ).includes('PHONE'),
  );

  check(
    'IF phone kept when present',
    applyIfBlocks(
      'A<!-- IF phone -->PHONE:{{phone}}<!-- ENDIF phone -->B',
      { phone: '555' },
    ) === 'APHONE:{{phone}}B',
  );

  check(
    'IF summary omitted when empty',
    !applyIfBlocks(
      'X<!-- IF summary -->SUM<!-- ENDIF summary -->Y',
      { summary: null },
    ).includes('SUM'),
  );

  {
    const html = renderLeadNotificationHtml({
      leadName: 'Ammar Test',
      company: 'Acme',
      email: 'ammar@example.com',
      context: 'Needs AI workflow help',
      summary: 'Wants a follow-up next week',
      phone: '+1 555 0100',
      role: 'CTO',
      pdfUrl: 'https://example.com/lead.pdf',
      pdfAttached: true,
      capturedAt: 'Aug 6, 2026, 12:00 PM EDT',
      approxLocation: 'Boston · Massachusetts · US',
    });
    check('HTML includes name', html.includes('Ammar Test'));
    check('HTML includes location + approx label', html.includes('Boston · Massachusetts · US') && html.includes('approx · via IP'));
    check('HTML includes phone row when present', html.includes('+1 555 0100'));
    check('HTML includes role row when present', html.includes('CTO'));
    check('HTML includes summary when present', html.includes('Wants a follow-up next week'));
    check('HTML includes PDF button when pdfUrl set', html.includes('Open conversation PDF'));
    check('HTML does not show Ref', !/\bRef\b/i.test(html) && !html.includes('lead_abc'));
    check('HTML includes VPN caveat footnote', /VPN or proxy/i.test(html));
  }

  {
    const html = renderLeadNotificationHtml({
      leadName: 'Local Dev',
      company: 'Acme',
      email: 'n@example.com',
      context: 'Topic',
      pdfUrl: '/uploads/case-assets/lead.pdf',
      pdfAttached: true,
      capturedAt: 'Aug 6, 2026',
      approxLocation: null,
    });
    check(
      'relative /uploads PDF is NOT used as button href',
      !html.includes('href="/uploads/') &&
        !html.includes('http://uploads/') &&
        !html.includes('Open conversation PDF'),
    );
    check(
      'relative PDF still shows attachment note (not generation-failed)',
      html.includes('Full conversation is attached as a PDF') &&
        !/PDF generation failed/i.test(html),
    );
  }

  {
    const html = renderLeadNotificationHtml({
      leadName: 'No Extras',
      company: 'Acme',
      email: 'n@example.com',
      context: 'Topic only',
      capturedAt: 'Aug 6, 2026',
      approxLocation: null,
      pdfUrl: null,
      pdfAttached: false,
      phone: null,
      role: null,
      summary: null,
    });
    check(
      'HTML Location unavailable when geo null',
      html.includes(LOCATION_UNAVAILABLE),
    );
    check('HTML omits phone when absent', !html.includes('Phone'));
    check('HTML omits role when absent', !/\bRole\b/.test(html));
    check('HTML omits summary when absent', !html.includes('Summary'));
    check(
      'HTML omits PDF button when no pdfUrl',
      !html.includes('Open conversation PDF'),
    );
    check(
      'HTML shows PDF-failed note when no pdfUrl',
      /PDF generation failed/i.test(html),
    );
  }

  {
    const text = renderLeadNotificationText({
      leadName: 'Plain',
      company: 'Co',
      email: 'p@example.com',
      context: 'Topic',
      capturedAt: 'now',
      approxLocation: null,
    });
    check(
      'plain-text includes Location unavailable',
      text.includes(LOCATION_UNAVAILABLE),
    );
    check('plain-text has no Lead ref line', !/Lead ref:/i.test(text));
    check('plain-text multipart body is non-empty', text.length > 40);
  }

  check(
    'token fill escapes HTML in values (via render)',
    renderLeadNotificationHtml({
      leadName: 'A <b>B</b>',
      company: 'C',
      email: 'e@x.com',
      context: 't',
      capturedAt: 'd',
    }).includes('A &lt;b&gt;B&lt;/b&gt;'),
  );

  check(
    'emailSafePublicUrl rejects relative /uploads paths',
    emailSafePublicUrl('/uploads/case-assets/x.pdf') === null &&
      emailSafePublicUrl('http://uploads/case-assets/x.pdf') === null &&
      emailSafePublicUrl('https://blob.vercel-storage.com/x.pdf') ===
        'https://blob.vercel-storage.com/x.pdf',
  );

  check(
    'fillTokens replaces known keys',
    fillTokens('Hello {{leadName}}', { leadName: 'Ali' }) === 'Hello Ali',
  );

  console.log('\n=== recipients unchanged ===\n');

  const prev = process.env.LEAD_NOTIFY_TO;
  delete process.env.LEAD_NOTIFY_TO;
  const defaults = leadNotifyRecipients();
  check(
    'default recipients are Ali + Marty (code-fixed)',
    defaults.length === 2 &&
      defaults.includes('ali@paramountintelligence.co') &&
      defaults.includes('marty@paramountintelligence.co'),
  );
  process.env.LEAD_NOTIFY_TO = 'test@example.com';
  check(
    'LEAD_NOTIFY_TO test redirect still works',
    leadNotifyRecipients().join(',') === 'test@example.com',
  );
  if (prev === undefined) delete process.env.LEAD_NOTIFY_TO;
  else process.env.LEAD_NOTIFY_TO = prev;

  check(
    'consent confirmation copy still present (unchanged by this change)',
    LEAD_CONFIG.CONFIRMATION.includes('shared your details'),
  );

  console.log('\n' + '='.repeat(48));
  console.log(
    failed === 0 ? `ALL PASSED (${passed})` : `FAILED ${failed} / ${passed + failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
