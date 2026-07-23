import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep native/serverless packages at their installed node_modules paths.
  // Bundling @sparticuz/chromium relocates it away from its bin/ payload.
  // pdf-parse / pdfjs-dist / mammoth must stay external so knowledge extraction
  // can require() them at runtime on Vercel (no webpack mangling).
  serverExternalPackages: [
    '@prisma/client',
    'openai',
    '@anthropic-ai/sdk',
    '@sparticuz/chromium',
    'puppeteer-core',
    'puppeteer',
    'pdf-parse',
    'pdfjs-dist',
    'mammoth',
  ],
  // Trace runtime assets into the serverless function bundles that need them.
  outputFileTracingIncludes: {
    '/api/chat': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/admin/cases/*/onepager': [
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
    // Admin knowledge PDF/DOCX extraction (in-process pdf-parse + mammoth).
    '/api/admin/knowledge': [
      './node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
      './node_modules/mammoth/**/*',
    ],
    '/api/admin/knowledge/[id]': [
      './node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
      './node_modules/mammoth/**/*',
    ],
  },
};

export default nextConfig;
