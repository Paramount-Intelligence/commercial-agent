/**
 * Unit tests for file hand-out rules (no database): attachments only ever
 * carry gated app routes, including old messages that stored a storage URL.
 *
 *   npx tsx scripts/test-file-access.ts
 */
import { buyerFileUrl, embedAttachments, extractAttachments } from '../lib/agent/attachments';
import type { OnepagerAttachment } from '../lib/agent/tools/generateCaseOnepager';
import { isSafeId } from '../lib/storage/fileAccess';
import { isLegacyFileUrl } from '../lib/storage/migrateFiles';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const BLOB = 'https://abc123.public.blob.vercel-storage.com/case-assets/x.pdf';
const onepager: OnepagerAttachment = {
  caseId: 'cmv123abc456',
  documentId: 'cmv123abc456:pdf',
  url: BLOB,
  filename: 'x.pdf',
  caseTitle: 'Field case',
  source: 'generated',
  format: 'pdf',
};
const knowledge: OnepagerAttachment = {
  documentId: 'knowledge:cke999',
  url: BLOB,
  filename: 'overview.pdf',
  caseTitle: 'Overview',
  source: 'knowledge-share',
  format: 'pdf',
};
const transcript: OnepagerAttachment = {
  documentId: 'transcript:c1',
  url: '/api/chat/transcript?conversationId=c1',
  filename: 't.pdf',
  caseTitle: 'Conversation transcript',
  source: 'transcript',
  format: 'pdf',
};

ok('one-pager maps to the gated route', buyerFileUrl(onepager) === '/api/files/onepager?caseId=cmv123abc456&format=pdf');
ok('knowledge doc maps to the gated route', buyerFileUrl(knowledge) === '/api/files/knowledge/cke999');
ok('transcript keeps its proxy', buyerFileUrl(transcript) === '/api/chat/transcript?conversationId=c1');
ok('transcript with a storage URL is dropped', buyerFileUrl({ ...transcript, url: BLOB }) === null);
ok('unknown attachment is dropped', buyerFileUrl({ ...knowledge, documentId: 'x', caseId: undefined }) === null);

// Old message stored with raw storage URLs → rewritten on read.
const legacyContent = `Here you go.\n\n<!--pi-attachments:${JSON.stringify([onepager, knowledge])}-->`;
const read = extractAttachments(legacyContent);
ok('old message: reply text kept', read.reply === 'Here you go.');
ok('old message: no storage URL survives', read.attachments.every((a) => !a.url.includes('vercel-storage')));
ok('old message: both attachments kept', read.attachments.length === 2);

const stored = embedAttachments('Reply', [onepager]);
ok('new message stores no storage URL', !stored.includes('vercel-storage') && stored.includes('/api/files/onepager'));

ok('public blob URL is legacy', isLegacyFileUrl(BLOB));
ok('local uploads path is legacy', isLegacyFileUrl('/uploads/case-assets/x.pdf'));
ok('private store URL is not legacy', !isLegacyFileUrl('https://abc123.private.blob.vercel-storage.com/x.pdf'));
ok('safe id accepted', isSafeId('cmv123abc456'));
ok('id with wildcard rejected', !isSafeId('abc%def') && !isSafeId('a"b') && !isSafeId(''));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
