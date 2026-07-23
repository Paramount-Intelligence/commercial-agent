/**
 * Local smoke for server DOCX extraction (mammoth).
 * PDF extraction is browser-only — use /admin/knowledge in the UI.
 *
 *   npx tsx scripts/test-knowledge-extract.ts [path.docx]
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { extractKnowledgeFileText } from '../lib/knowledge/extractText';

async function main() {
  const filePath =
    process.argv[2] ||
    path.join(
      process.cwd(),
      'docs/Paramount_Chatbot_Knowledge_Base_Ali_Marty - Final.docx',
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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
