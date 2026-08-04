/**
 *   npx tsx scripts/test-clean-voice-text.ts
 */
import {
  cleanVoiceText,
  expandCurrencyForSpeech,
  formatVoiceDisplayText,
} from '../lib/citationText';

const sample =
  "Sure, here's the pricing again: | Category | Indicative range || --- | --- || Six-level talent pool (overall) | $90-$200 / hour || Strategy / Advisory | $150-$250 / hour |";

const spoken = cleanVoiceText(sample);
console.log('spoken:', spoken);
const display = formatVoiceDisplayText(sample);
console.log('display:', display);

const spokenOk =
  !spoken.includes('|') &&
  /90 to 200 dollars per hour/i.test(spoken) &&
  /150 to 250 dollars per hour/i.test(spoken);

const displayOk =
  display.includes('| Category |') &&
  display.includes('$90-$200 / hour') &&
  display.includes('\n');

const money = expandCurrencyForSpeech(
  'Rates are $90–$200 / hour and $150 per hour.',
);
const moneyOk =
  /90 to 200 dollars per hour/.test(money) &&
  /150 dollars per hour/.test(money);
console.log('money:', money);

if (!spokenOk || !displayOk || !moneyOk) {
  console.error('FAIL', { spokenOk, displayOk, moneyOk });
  process.exit(1);
}
console.log('PASS');
