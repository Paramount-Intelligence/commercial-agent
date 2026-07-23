/**
 * Local smoke for knowledge extractors (pdf-parse@1 + mammoth).
 * Not a substitute for a Vercel prod upload test.
 *
 *   npx tsx --env-file=.env.local scripts/test-knowledge-extract.ts [path.pdf|.docx]
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { extractKnowledgeFileText } from '../lib/knowledge/extractText';

async function main() {
  const filePath =
    process.argv[2] ||
    path.join(
      process.cwd(),
      'public/uploads/admin-knowledge/1784771835477-ae9cc465-Paramount_Intelligence_-_Company_Overview_-_July_2026.pptx.pdf',
    );

  const buffer = await readFile(filePath);
  const result = await extractKnowledgeFileText({
    buffer,
    filename: path.basename(filePath),
  });

  console.log({
    file: path.basename(filePath),
    format: result.format,
    empty: result.empty,
    chars: result.text.length,
    head: result.text.slice(0, 120).replace(/\s+/g, ' '),
  });

  // Prove DOMMatrix is not required (pdf-parse v1 path).
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
    console.log('DOMMatrix undefined — ok for pdf-parse@1 Node path');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
