import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Help diagnose minified serverless stack frames (e.g. "a is not a function").
  productionBrowserSourceMaps: true,
  experimental: {
    serverSourceMaps: true,
  },
  // Keep native/serverless packages at their installed node_modules paths.
  // PDF parsing is client-side (pdfjs-dist) — do not load pdf-parse on the server.
  // mammoth stays external for DOCX extraction on knowledge APIs.
  serverExternalPackages: [
    '@prisma/client',
    'openai',
    '@anthropic-ai/sdk',
    '@sparticuz/chromium',
    'puppeteer-core',
    'puppeteer',
    'mammoth',
  ],
  outputFileTracingIncludes: {
    '/api/chat': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/admin/cases/*/onepager': [
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
    // DOCX only on the server now.
    '/api/admin/knowledge': ['./node_modules/mammoth/**/*'],
    '/api/admin/knowledge/[id]': ['./node_modules/mammoth/**/*'],
  },
};

export default nextConfig;
