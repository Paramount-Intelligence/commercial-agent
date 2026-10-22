import { strict as assert } from 'assert';
import { assistantName } from '../lib/agent/identity';
import { personaFallback } from '../lib/agent/fallbacks';
import { newestHistoryFirst, VERBATIM_HISTORY_MESSAGES } from '../lib/agent/history';
import { deterministicRemainderAnswers, dropOffendingSentences } from '../lib/agent/responseSalvage';
import { cleanVoiceText } from '../lib/citationText';
import { spokenWords, trimVoiceReply, VOICE_MAX_WORDS } from '../lib/agent/voiceLength';

const user = { name: 'Jane Doe', email: 'jane@example.com', affiliation: 'Acme' };
assert.equal(assistantName({}), 'Paramount Assistant');
assert.equal(assistantName({ ASSISTANT_NAME: 'Paramount Guide' }), 'Paramount Guide');

for (const type of ['general', 'company', 'pricing', 'contact', 'lead', 'document', 'overload'] as const) {
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    const value = personaFallback(type, seen, user);
    assert(!seen.includes(value), `${type} fallback repeated`);
    seen.push(value);
  }
}

const rows = Array.from({ length: 30 }, (_, i) => ({ id: String(i), value: i })).reverse();
const bounded = newestHistoryFirst(rows, '29');
assert.equal(bounded.length, VERBATIM_HISTORY_MESSAGES);
assert.deepEqual(bounded.map((row) => row.value), Array.from({ length: 20 }, (_, i) => i + 9));

const salvaged = dropOffendingSentences(
  'We build production AI systems. We built one for Bykea. We can discuss the architecture.',
  ['We built one for Bykea.'],
);
assert.equal(salvaged, 'We build production AI systems. We can discuss the architecture.');
assert(deterministicRemainderAnswers('What AI systems do you build?', salvaged));
assert(!deterministicRemainderAnswers('What do you charge?', 'Please ask again.'));

const speech = cleanVoiceText('Email ali@paramountintelligence.co. Rates are $90-$200 / hour with a 10% discount. Call 443.494.9144.');
assert(speech.includes('ali at paramountintelligence dot co'));
assert(speech.includes('ninety to two hundred dollars per hour'));
assert(speech.includes('ten percent'));
assert(speech.includes('four four three'));

// Speech: ranges in any form read naturally.
const ranges = cleanVoiceText('Delivery is $90-$200 an hour, advisory $150-$250, with a 10%-30% discount.');
assert(ranges.includes('ninety to two hundred dollars an hour'), ranges);
assert(ranges.includes('one hundred fifty to two hundred fifty dollars'), ranges);
assert(ranges.includes('ten to thirty percent'), ranges);

// Voice backstop: whole sentences from the start, within 50 words and 3 sentences.
const long =
  'Yes, we have built several production systems on AWS. The closest is a field intelligence platform on Amazon Bedrock for a field service company. [[case:field]] It processes thousands of forms a day into structured data and manager summaries inside the client environment. We also use Lambda, S3, DynamoDB and CDK across projects. What are you building?';
const trimmed = trimVoiceReply(long);
assert(spokenWords(trimmed) <= VOICE_MAX_WORDS, `trimmed to ${spokenWords(trimmed)} words`);
assert(trimmed.startsWith('Yes, we have built'), 'keeps the answer first');
assert(trimmed.includes('[[case:field]]'), 'keeps the citation with its sentence');
assert(/[.!?](?:\s*\[\[[^\]]+\]\])*$/.test(trimmed), 'ends on a whole sentence');
assert.equal(trimVoiceReply('Yes. We can help with that.'), 'Yes. We can help with that.');
const oneLong = `${'word '.repeat(70).trim()}.`;
assert.equal(trimVoiceReply(oneLong), oneLong, 'a single long sentence is never cut');

console.log('ALL PASSED (Phase 3a)');
