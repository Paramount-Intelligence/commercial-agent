/**
 * CommonJS PDF text helper — kept outside the Next/webpack graph so
 * pdf-parse loads from node_modules via real require().
 */
const { PDFParse } = require('pdf-parse');

/**
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return typeof result?.text === 'string' ? result.text : '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

module.exports = { extractPdfText };
