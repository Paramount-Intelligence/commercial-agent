/**
 * CLI entry for PDF text extraction — runs in a real Node subprocess,
 * outside Next/webpack, so pdf-parse loads cleanly.
 *
 * Usage: node lib/knowledge/pdfParse.cli.cjs <absolute-pdf-path>
 * Prints JSON: { "text": "..." }
 */
const fs = require('fs');
const { extractPdfText } = require('./pdfParse.cjs');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write('usage: pdfParse.cli.cjs <pdf-path>\n');
    process.exit(1);
  }
  const buffer = fs.readFileSync(filePath);
  const text = await extractPdfText(buffer);
  process.stdout.write(JSON.stringify({ text }));
}

main().catch((err) => {
  process.stderr.write(err?.stack || String(err));
  process.stderr.write('\n');
  process.exit(1);
});
