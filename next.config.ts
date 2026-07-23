import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep native/serverless packages at their installed node_modules paths.
  // Bundling @sparticuz/chromium relocates it away from its bin/ payload.
  // pdf-parse@1 + mammoth stay external so knowledge extraction works on Vercel.
  serverExternalPackages: [
    '@prisma/client',
    'openai',
    '@anthropic-ai/sdk',
    '@sparticuz/chromium',
    'puppeteer-core',
    'puppeteer',
    'pdf-parse',
    'mammoth',
  ],
  // Trace runtime assets into the serverless function bundles that need them.
  outputFileTracingIncludes: {
    '/api/chat': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/admin/cases/*/onepager': [
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
    // Admin knowledge PDF/DOCX extraction (pdf-parse@1 + mammoth, in-process).
    '/api/admin/knowledge': [
      './node_modules/pdf-parse/**/*',
      './node_modules/mammoth/**/*',
    ],
    '/api/admin/knowledge/[id]': [
      './node_modules/pdf-parse/**/*',
      './node_modules/mammoth/**/*',
    ],
  },
};

export default nextConfig;
